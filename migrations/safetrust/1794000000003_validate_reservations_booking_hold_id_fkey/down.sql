-- Undo the attachment step, keeping the column and the supporting unique index
-- that `1794000000000_link_reservations_to_booking_holds` created. Dropping the
-- constraint drops the index it adopted, so it is rebuilt here.
ALTER TABLE safetrust.reservations
  DROP CONSTRAINT IF EXISTS reservations_booking_hold_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_booking_hold_id_key
  ON safetrust.reservations (booking_hold_id);
