-- Revert: Add cancellation fields to reservations (safetrust tenant)

DROP INDEX IF EXISTS safetrust.idx_reservations_cancelled_by;

ALTER TABLE safetrust.reservations
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancel_reason;
