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
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'settled', 'failed')),
  tx_hash VARCHAR(64),
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_x402_settlements_status
  ON safetrust.x402_settlements (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_x402_settlements_purpose
  ON safetrust.x402_settlements (purpose);

COMMENT ON TABLE safetrust.x402_settlements
  IS 'Idempotent x402 settlement receipts. A settled row is reused on retry; pending rows block concurrent settlement of the same payment.';
