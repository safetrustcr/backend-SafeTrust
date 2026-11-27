ALTER TABLE safetrust.reservations
  DROP CONSTRAINT IF EXISTS reservations_booking_hold_id_key;

ALTER TABLE safetrust.reservations
  DROP CONSTRAINT IF EXISTS reservations_booking_hold_id_fkey;

ALTER TABLE safetrust.reservations
  DROP COLUMN IF EXISTS booking_hold_id;
