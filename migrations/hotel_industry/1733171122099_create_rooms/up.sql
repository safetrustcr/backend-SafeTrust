CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.rooms (
    room_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hotel_id UUID NOT NULL REFERENCES hotel_industry.hotels(id) ON DELETE CASCADE,
    room_number VARCHAR(5) NOT NULL,
    room_type_id UUID NOT NULL REFERENCES hotel_industry.room_types(id) ON DELETE RESTRICT,
    price_night DECIMAL(10,2) NOT NULL CHECK (price_night > 0),
    capacity INTEGER NOT NULL,
    status BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(hotel_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_rooms_hotel_id ON hotel_industry.rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON hotel_industry.rooms(room_type_id);