-- Migration: Add partially_funded and untrusted statuses, and create escrow_verification_events table
-- Release: Issue #832 Escrow Verification

DO $$
BEGIN
  -- 1. Update valid_escrow_status check constraint on safetrust.trustless_work_escrows
  ALTER TABLE safetrust.trustless_work_escrows
    DROP CONSTRAINT IF EXISTS valid_escrow_status;

  ALTER TABLE safetrust.trustless_work_escrows
    ADD CONSTRAINT valid_escrow_status CHECK (status IN (
      'created', 'pending_funding', 'partially_funded', 'funded', 'active',
      'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled', 'untrusted'
    ));

  -- 2. Update valid_reservation_status check constraint on safetrust.reservations
  ALTER TABLE safetrust.reservations
    DROP CONSTRAINT IF EXISTS valid_reservation_status;

  ALTER TABLE safetrust.reservations
    ADD CONSTRAINT valid_reservation_status CHECK (status IN (
      'pending', 'escrow_created', 'partially_funded', 'funded', 'checked_in',
      'checked_out', 'completed', 'disputed', 'resolved', 'cancelled', 'untrusted'
    ));

  -- 3. Create safetrust.escrow_verification_events table
  CREATE TABLE IF NOT EXISTS safetrust.escrow_verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id UUID,
    reservation_id UUID,
    contract_id VARCHAR(255),
    result VARCHAR(32) NOT NULL,
    mismatches JSONB DEFAULT '[]'::jsonb,
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_escrow_verification_events_contract_id
    ON safetrust.escrow_verification_events(contract_id);
  CREATE INDEX IF NOT EXISTS idx_escrow_verification_events_reservation_id
    ON safetrust.escrow_verification_events(reservation_id);
  CREATE INDEX IF NOT EXISTS idx_escrow_verification_events_result
    ON safetrust.escrow_verification_events(result);
  CREATE INDEX IF NOT EXISTS idx_escrow_verification_events_checked_at
    ON safetrust.escrow_verification_events(checked_at);
END $$;
