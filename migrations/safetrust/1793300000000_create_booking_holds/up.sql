-- Paid, short-lived date holds for the agent API (POST /api/v1/bookings/hold).
-- A hold blocks an apartment's dates for everybody else until it is released,
-- converted into a booking, or expires.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS safetrust.booking_holds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR(255) NOT NULL DEFAULT 'safetrust',
  apartment_id   UUID NOT NULL REFERENCES safetrust.apartments(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES safetrust.users(id),
  check_in       TIMESTAMPTZ NOT NULL,
  check_out      TIMESTAMPTZ NOT NULL,
  guests         INTEGER NOT NULL CHECK (guests > 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment', 'active', 'converted', 'released', 'expired')),
  quote_total    NUMERIC(20, 7) NOT NULL CHECK (quote_total >= 0),
  quote_deposit  NUMERIC(20, 7) NOT NULL CHECK (quote_deposit >= 0),
  asset_code     VARCHAR(10) NOT NULL DEFAULT 'USDC',
  payer_address  TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_holds_valid_dates CHECK (check_out > check_in),
  -- Two live holds on the same apartment cannot overlap. The predicate cannot
  -- use now(), so the insert transaction marks lapsed holds as 'expired'
  -- before inserting and hold-expiry.job.ts sweeps the rest.
  CONSTRAINT booking_holds_no_overlap
    EXCLUDE USING gist (
      apartment_id WITH =,
      tstzrange(check_in, check_out, '[)') WITH &&
    ) WHERE (status IN ('pending_payment', 'active'))
);

CREATE INDEX IF NOT EXISTS idx_booking_holds_expires_at
  ON safetrust.booking_holds (expires_at)
  WHERE status IN ('pending_payment', 'active');
CREATE INDEX IF NOT EXISTS idx_booking_holds_user_live
  ON safetrust.booking_holds (user_id)
  WHERE status IN ('pending_payment', 'active');
CREATE INDEX IF NOT EXISTS idx_booking_holds_tenant
  ON safetrust.booking_holds (tenant_id);

COMMENT ON TABLE safetrust.booking_holds
  IS 'Paid 10-minute date holds (x402, 0.01 USDC, non-refundable). Live statuses: pending_payment, active.';
