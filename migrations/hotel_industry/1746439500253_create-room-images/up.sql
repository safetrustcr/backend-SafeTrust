CREATE TABLE room_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(room_id),
    image_url VARCHAR(150),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_room_id ON room_images (room_id);
