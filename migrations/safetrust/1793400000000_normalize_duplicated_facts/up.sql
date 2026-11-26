-- Issue #790: one home for each fact. Runs in one transaction (hasura migrate).

-- users.role -> user_roles is the only source (a user can be host and guest).
-- Copy every users.role value that user_roles does not already hold, then drop.
INSERT INTO safetrust.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM safetrust.users u
JOIN safetrust.roles r ON r.name = u.role
WHERE NOT EXISTS (
  SELECT 1 FROM safetrust.user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
);
DROP INDEX IF EXISTS safetrust.idx_users_role;
ALTER TABLE safetrust.users DROP CONSTRAINT IF EXISTS valid_user_role;
ALTER TABLE safetrust.users DROP COLUMN role;

-- apartments: capacity and max_guests are the same fact. Keep max_guests
-- (the larger value wins so no listing loses guest places).
UPDATE safetrust.apartments SET max_guests = GREATEST(COALESCE(max_guests, 0), COALESCE(capacity, 0)) WHERE capacity IS DISTINCT FROM max_guests;
DROP INDEX IF EXISTS safetrust.idx_apartments_capacity;
ALTER TABLE safetrust.apartments DROP CONSTRAINT IF EXISTS valid_capacity;
ALTER TABLE safetrust.apartments DROP COLUMN capacity;

-- pricing_overrides.user_id_list text[] -> pricing_override_users
CREATE TABLE safetrust.pricing_override_users (
  override_id uuid NOT NULL REFERENCES safetrust.pricing_overrides(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES safetrust.users(id) ON DELETE CASCADE,
  PRIMARY KEY (override_id, user_id)
);
CREATE INDEX idx_pricing_override_users_user ON safetrust.pricing_override_users(user_id);
-- Only ids that exist in users can be copied (foreign key); distinct ids per override.
INSERT INTO safetrust.pricing_override_users (override_id, user_id)
SELECT DISTINCT po.id, uid
FROM safetrust.pricing_overrides po
CROSS JOIN LATERAL unnest(po.user_id_list) AS uid
JOIN safetrust.users u ON u.id = uid;
ALTER TABLE safetrust.pricing_overrides DROP COLUMN user_id_list;

-- bid_requests.tenant_id holds the bidder's user id -> bidder_id
ALTER TABLE safetrust.bid_requests RENAME COLUMN tenant_id TO bidder_id;
ALTER TABLE safetrust.bid_requests RENAME CONSTRAINT bid_requests_tenant_id_fkey TO bid_requests_bidder_id_fkey;
ALTER INDEX safetrust.idx_bid_requests_tenant RENAME TO idx_bid_requests_bidder;

CREATE OR REPLACE FUNCTION public.check_active_bids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.current_status IN ('PENDING', 'VIEWED', 'APPROVED') THEN
        IF EXISTS (
            SELECT 1 FROM safetrust.bid_requests
            WHERE bidder_id = NEW.bidder_id
            AND id != NEW.id
            AND current_status IN ('PENDING', 'VIEWED', 'APPROVED')
            AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Tenant already has an active bid';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_bid_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (OLD.current_status IS DISTINCT FROM NEW.current_status) THEN
        INSERT INTO safetrust.bid_status_histories (bid_request_id, status, changed_by)
        VALUES (NEW.id, NEW.current_status, NEW.bidder_id);
    END IF;
    RETURN NEW;
END;
$$;
