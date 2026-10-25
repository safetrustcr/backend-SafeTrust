-- Migration: Add cancellation fields to reservations (safetrust tenant)
-- Description: Adds cancelled_by, cancelled_at, and cancel_reason to safetrust.reservations
--              to safely track reservation cancellations.

ALTER TABLE safetrust.reservations
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT REFERENCES safetrust.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reservations_cancelled_by
  ON safetrust.reservations(cancelled_by);

COMMENT ON COLUMN safetrust.reservations.cancelled_by
  IS 'User ID of the party (guest or apartment owner) who cancelled the reservation';
COMMENT ON COLUMN safetrust.reservations.cancelled_at
  IS 'Timestamp when the reservation was cancelled';
COMMENT ON COLUMN safetrust.reservations.cancel_reason
  IS 'Optional cancellation reason provided by the cancelling party (max 500 characters)';
