-- Link each hold-based reservation to its originating booking hold.
-- Nullable to preserve existing reservations created without holds.

ALTER TABLE safetrust.reservations
  ADD COLUMN IF NOT EXISTS booking_hold_id UUID;

-- Added NOT VALID first: the constraint is installed without scanning the
-- table, so existing rows are never locked out of reads or writes while it is
-- checked. `1794000000003_validate_reservations_booking_hold_id_fkey` validates
-- it in its own transaction.
--
-- `CREATE INDEX CONCURRENTLY` is deliberately not used here: `hasura migrate
-- apply` sends each migration inside one transaction, where Postgres rejects
-- CONCURRENTLY (25001). The index builds on a column this migration just added,
-- so every existing row holds NULL and the build is a fast metadata-only pass.
ALTER TABLE safetrust.reservations
  DROP CONSTRAINT IF EXISTS reservations_booking_hold_id_fkey;

ALTER TABLE safetrust.reservations
  ADD CONSTRAINT reservations_booking_hold_id_fkey
  FOREIGN KEY (booking_hold_id)
  REFERENCES safetrust.booking_holds(id)
  ON DELETE RESTRICT
  NOT VALID;

-- A booking hold can produce at most one reservation. Created as a named unique
-- index so `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX` can attach it
-- later without rebuilding the index.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_booking_hold_id_key
  ON safetrust.reservations (booking_hold_id);

COMMENT ON COLUMN safetrust.reservations.booking_hold_id
  IS 'The booking hold converted into this reservation, NULL for legacy bookings.';
