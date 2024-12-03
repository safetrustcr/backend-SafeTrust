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