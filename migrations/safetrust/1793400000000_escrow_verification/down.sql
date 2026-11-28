DO $$
BEGIN
  DROP TABLE IF EXISTS safetrust.escrow_verification_events;

  -- Data-preserving downgrade procedure: remap newer statuses before applying original CHECK constraints
  UPDATE safetrust.trustless_work_escrows
  SET status = 'pending_funding'
  WHERE status = 'partially_funded';

  UPDATE safetrust.trustless_work_escrows
  SET status = 'disputed'
  WHERE status = 'untrusted';

  ALTER TABLE safetrust.trustless_work_escrows
    DROP CONSTRAINT IF EXISTS valid_escrow_status;

  ALTER TABLE safetrust.trustless_work_escrows
    ADD CONSTRAINT valid_escrow_status CHECK (status IN (
      'created', 'pending_funding', 'funded', 'active',
      'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled'
    ));

  UPDATE safetrust.reservations
  SET status = 'disputed'
  WHERE status = 'untrusted';

  ALTER TABLE safetrust.reservations
    DROP CONSTRAINT IF EXISTS valid_reservation_status;

  ALTER TABLE safetrust.reservations
    ADD CONSTRAINT valid_reservation_status CHECK (status IN (
      'pending', 'escrow_created', 'funded', 'checked_in',
      'checked_out', 'completed', 'disputed', 'resolved', 'cancelled'
    ));
END $$;
