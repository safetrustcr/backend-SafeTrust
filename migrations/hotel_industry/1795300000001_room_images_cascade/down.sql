DO $$
DECLARE
  oversized_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO oversized_count
  FROM hotel_industry.room_images
  WHERE length(image_url) > 150;

  IF oversized_count > 0 THEN
    RAISE EXCEPTION
      'Cannot restore room_images.image_url varchar(150): % existing URL(s) exceed 150 characters',
      oversized_count;
  END IF;
END;
$$;

ALTER TABLE hotel_industry.room_images
  DROP CONSTRAINT room_images_room_id_fkey,
  ALTER COLUMN room_id DROP NOT NULL,
  ALTER COLUMN image_url TYPE VARCHAR(150),
  ADD CONSTRAINT room_images_room_id_fkey
    FOREIGN KEY (room_id)
    REFERENCES hotel_industry.rooms(id);
