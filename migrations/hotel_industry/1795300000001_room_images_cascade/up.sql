DO $$
DECLARE
  orphan_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM hotel_industry.room_images
  WHERE room_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE 'Deleting % room_images row(s) with NULL room_id', orphan_count;
    DELETE FROM hotel_industry.room_images
    WHERE room_id IS NULL;
  END IF;
END;
$$;

ALTER TABLE hotel_industry.room_images
  DROP CONSTRAINT room_images_room_id_fkey,
  ALTER COLUMN room_id SET NOT NULL,
  ALTER COLUMN image_url TYPE TEXT,
  ADD CONSTRAINT room_images_room_id_fkey
    FOREIGN KEY (room_id)
    REFERENCES hotel_industry.rooms(id)
    ON DELETE CASCADE;
