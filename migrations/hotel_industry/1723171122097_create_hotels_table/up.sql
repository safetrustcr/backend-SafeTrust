CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS hotel_industry.hotels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(20) NOT NULL,
    description VARCHAR(50),
    address VARCHAR(50) NOT NULL,
    location_area VARCHAR(20),
    coordinates geometry(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_name
    ON hotel_industry.hotels(name);
CREATE INDEX IF NOT EXISTS idx_hotels_location_area
    ON hotel_industry.hotels(location_area);
CREATE INDEX IF NOT EXISTS idx_hotels_coordinates
    ON hotel_industry.hotels USING GIST (coordinates);

CREATE OR REPLACE FUNCTION hotel_industry.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_updated_at
BEFORE UPDATE ON hotel_industry.hotels
FOR EACH ROW
EXECUTE FUNCTION hotel_industry.update_updated_at_column();