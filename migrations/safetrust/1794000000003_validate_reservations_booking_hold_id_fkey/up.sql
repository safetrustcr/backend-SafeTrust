-- Second, separate transaction for the work that must not hold a long lock on
-- safetrust.reservations while it runs:
--
-- 1. Attach the unique index built by the previous migration as a real UNIQUE
--    constraint. `USING INDEX` adopts the already-built index, so this is a
--    metadata change instead of a second index build.
-- 2. Validate the NOT VALID foreign key installed by the previous migration.
--    VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE, which does not block
--    inserts, updates or deletes on reservations.

ALTER TABLE safetrust.reservations
  ADD CONSTRAINT reservations_booking_hold_id_key
  UNIQUE USING INDEX reservations_booking_hold_id_key;

ALTER TABLE safetrust.reservations
  VALIDATE CONSTRAINT reservations_booking_hold_id_fkey;
