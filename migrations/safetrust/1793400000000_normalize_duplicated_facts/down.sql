-- NOTE: revert the Hasura metadata together with this migration. After this rollback
-- metadata/tenants/safetrust/databases/tables/public_bid_requests.yaml (permissions and
-- relationships) and public_bid_status_histories.yaml must reference tenant_id, not bidder_id,
-- or Hasura metadata will be inconsistent with the restored schema.
ALTER TABLE safetrust.bid_requests RENAME COLUMN bidder_id TO tenant_id;
ALTER TABLE safetrust.bid_requests RENAME CONSTRAINT bid_requests_bidder_id_fkey TO bid_requests_tenant_id_fkey;
ALTER INDEX safetrust.idx_bid_requests_bidder RENAME TO idx_bid_requests_tenant;
CREATE OR REPLACE FUNCTION public.check_active_bids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.current_status IN ('PENDING', 'VIEWED', 'APPROVED') THEN
        IF EXISTS (
            SELECT 1 FROM safetrust.bid_requests
            WHERE tenant_id = NEW.tenant_id AND id != NEW.id
            AND current_status IN ('PENDING', 'VIEWED', 'APPROVED') AND deleted_at IS NULL
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
        VALUES (NEW.id, NEW.current_status, NEW.tenant_id);
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE safetrust.pricing_overrides ADD COLUMN user_id_list text[];
UPDATE safetrust.pricing_overrides po SET user_id_list = s.ids
FROM (SELECT override_id, array_agg(user_id ORDER BY user_id) ids FROM safetrust.pricing_override_users GROUP BY override_id) s
WHERE s.override_id = po.id;
DROP TABLE safetrust.pricing_override_users;

ALTER TABLE safetrust.apartments ADD COLUMN capacity integer DEFAULT 2;
UPDATE safetrust.apartments SET capacity = max_guests;
ALTER TABLE safetrust.apartments ADD CONSTRAINT valid_capacity CHECK (capacity > 0);
CREATE INDEX idx_apartments_capacity ON safetrust.apartments(capacity);

ALTER TABLE safetrust.users ADD COLUMN role varchar(20) NOT NULL DEFAULT 'guest';
UPDATE safetrust.users u SET role = COALESCE((
  SELECT r.name FROM safetrust.user_roles ur JOIN safetrust.roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'host' THEN 2 ELSE 3 END LIMIT 1), 'guest');
ALTER TABLE safetrust.users ADD CONSTRAINT valid_user_role CHECK (role IN ('guest','host','admin'));
CREATE INDEX idx_users_role ON safetrust.users(role);

