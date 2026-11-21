-- Link each hold-based reservation to its originating booking hold.
-- Nullable to preserve existing reservations created without holds.

ALTER TABLE safetrust.reservations
  ADD COLUMN booking_hold_id UUID;

ALTER TABLE safetrust.reservations
  ADD CONSTRAINT reservations_booking_hold_id_fkey
  FOREIGN KEY (booking_hold_id)
  REFERENCES safetrust.booking_holds(id)
  ON DELETE RESTRICT;

-- A booking hold can produce at most one reservation.
ALTER TABLE safetrust.reservations
  ADD CONSTRAINT reservations_booking_hold_id_key
  UNIQUE (booking_hold_id);

COMMENT ON COLUMN safetrust.reservations.booking_hold_id
  IS 'The booking hold converted into this reservation; NULL for legacy bookings.';
