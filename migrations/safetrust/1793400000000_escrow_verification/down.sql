DO $$
BEGIN
  DROP TABLE IF EXISTS safetrust.escrow_verification_events;

  ALTER TABLE safetrust.trustless_work_escrows
    DROP CONSTRAINT IF EXISTS valid_escrow_status;

  ALTER TABLE safetrust.trustless_work_escrows
    ADD CONSTRAINT valid_escrow_status CHECK (status IN (
      'created', 'pending_funding', 'funded', 'active',
      'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled'
    ));

  ALTER TABLE safetrust.reservations
    DROP CONSTRAINT IF EXISTS valid_reservation_status;

  ALTER TABLE safetrust.reservations
    ADD CONSTRAINT valid_reservation_status CHECK (status IN (
      'pending', 'escrow_created', 'funded', 'checked_in',
      'checked_out', 'completed', 'disputed', 'resolved', 'cancelled'
    ));
END $$;
