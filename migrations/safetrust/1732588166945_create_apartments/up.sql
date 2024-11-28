CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';
-- Create apartments table
CREATE TABLE apartments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL CHECK (price > 0),
    warranty_deposit DECIMAL(10,2) NOT NULL CHECK (warranty_deposit > 0),
    coordinates POINT NOT NULL,
    location_area GEOMETRY(POLYGON, 4326),
    address JSONB NOT NULL,
    is_available BOOLEAN DEFAULT true,
    available_from TIMESTAMP WITH TIME ZONE NOT NULL,
    available_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_date_range 
        CHECK (available_until IS NULL OR available_from < available_until)
);

-- Create spatial index
CREATE INDEX idx_apartments_coordinates 
    ON apartments USING GIST (coordinates);
CREATE INDEX idx_apartments_location_area 
    ON apartments USING GIST (location_area);

-- Create regular indexes
CREATE INDEX idx_apartments_owner 
    ON apartments(owner_id);
CREATE INDEX idx_apartments_availability 
    ON apartments(is_available, available_from, available_until);
CREATE INDEX idx_apartments_price 
    ON apartments(price);

-- Create update trigger for updated_at
CREATE TRIGGER update_apartments_updated_at
    BEFORE UPDATE ON apartments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create helper function for nearby apartments
CREATE OR REPLACE FUNCTION find_nearby_apartments(
    search_location POINT,
    radius_meters FLOAT,
    min_price DECIMAL DEFAULT NULL,
    max_price DECIMAL DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    distance FLOAT,
    name TEXT,
    price DECIMAL,
    coordinates POINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        ST_Distance(
            a.coordinates::geometry, 
            search_location::geometry
        ) as distance,
        a.name,
        a.price,
        a.coordinates
    FROM apartments a
    WHERE 
        a.is_available = true
        AND a.deleted_at IS NULL
        AND ST_DWithin(
            a.coordinates::geometry,
            search_location::geometry,
            radius_meters
        )
        AND (min_price IS NULL OR a.price >= min_price)
        AND (max_price IS NULL OR a.price <= max_price)
    ORDER BY distance;
END;
$$ LANGUAGE plpgsql STABLE;