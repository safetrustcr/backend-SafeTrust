-- ============================================================================
-- Migration: Create x402 Settlements Table
-- Description: Durable record of x402 settlement attempts, keyed by the hash
--              of the X-Payment header, so a retried request can reuse a
--              confirmed settlement instead of charging the guest twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS safetrust.x402_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(66) NOT NULL UNIQUE,
  purpose VARCHAR(40) NOT NULL DEFAULT 'booking_fee',
  amount_usdc NUMERIC(20, 7) NOT NULL CHECK (amount_usdc >= 0),
  network VARCHAR(32),
  payer_address TEXT,
  -- The booking hold this payment proof paid for, when it bought a hold. A
  -- settled proof may only be reused for the same hold.
  hold_id UUID REFERENCES safetrust.booking_holds(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'settled', 'failed')),
  tx_hash VARCHAR(64),
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  -- Ownership token for the request currently settling this row. A row is
  -- claimed by setting a fresh token, and only the holder of the current token
  -- may mark the attempt failed, so a request that lost the row to a takeover
  -- can never overwrite the newer attempt's outcome.
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_x402_settlements_status
  ON safetrust.x402_settlements (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_x402_settlements_purpose
  ON safetrust.x402_settlements (purpose);

CREATE INDEX IF NOT EXISTS idx_x402_settlements_hold_id
  ON safetrust.x402_settlements (hold_id);

COMMENT ON TABLE safetrust.x402_settlements
  IS 'Idempotent x402 settlement receipts. A settled row is reused on retry only for the hold it paid for; pending rows block concurrent settlement of the same payment.';
