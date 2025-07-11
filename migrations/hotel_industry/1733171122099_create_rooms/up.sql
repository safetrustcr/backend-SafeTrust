-- Create extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Rooms table with foreign key to Hotels
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id), 
    hotel_id UUID REFERENCES hotels(id),
    room_number VARCHAR(3),
    room_type UUID REFERENCES room_types(type_id),
    price_night NUMERIC(10, 2),
    status BOOLEAN DEFAULT TRUE,
    capacity INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- Create indexes for performance
CREATE INDEX idx_rooms_hotel_id ON rooms(hotel_id);
CREATE INDEX idx_rooms_room_type ON rooms(room_type); 
