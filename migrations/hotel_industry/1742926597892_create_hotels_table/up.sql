CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS hotels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(20) NOT NULL,
    description VARCHAR(50),
    address VARCHAR(50) NOT NULL,
    location_area VARCHAR(20),
    coordinates geometry(Point, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_hotels_name ON hotels(name);
CREATE INDEX idx_hotels_location_area ON hotels(location_area);
CREATE INDEX idx_hotels_coordinates ON hotels USING GIST (coordinates);
