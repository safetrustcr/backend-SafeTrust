CREATE TABLE hotel_industry.hotel_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL
    REFERENCES hotel_industry.hotels(id)
    ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hotel_images_hotel_position
  ON hotel_industry.hotel_images(hotel_id, position);
