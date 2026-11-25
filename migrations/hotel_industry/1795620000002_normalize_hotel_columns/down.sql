DROP FUNCTION IF EXISTS hotel_industry.find_nearby_hotels(
    POINT,
    DOUBLE PRECISION,
    CHARACTER VARYING
);

DROP INDEX IF EXISTS hotel_industry.idx_hotels_neighborhood;

ALTER TABLE hotel_industry.hotels
    DROP CONSTRAINT IF EXISTS hotels_name_length,
    DROP CONSTRAINT IF EXISTS hotels_description_length,
    ADD COLUMN address VARCHAR(50);

UPDATE hotel_industry.hotels
SET address = LEFT(CONCAT_WS(', ', address_line, city), 50);

ALTER TABLE hotel_industry.hotels
    ALTER COLUMN name TYPE VARCHAR(20)
        USING LEFT(name, 20)::VARCHAR(20),
    ALTER COLUMN description TYPE VARCHAR(50)
        USING LEFT(description, 50)::VARCHAR(50),
    ALTER COLUMN address SET NOT NULL,
    ALTER COLUMN neighborhood TYPE VARCHAR(20)
        USING LEFT(neighborhood, 20)::VARCHAR(20),
    DROP COLUMN address_line,
    DROP COLUMN city,
    DROP COLUMN country_code;

ALTER TABLE hotel_industry.hotels
    RENAME COLUMN neighborhood TO location_area;

CREATE INDEX idx_hotels_location_area
    ON hotel_industry.hotels(location_area);

CREATE FUNCTION hotel_industry.find_nearby_hotels(
    search_location POINT,
    radius_meters FLOAT,
    location_area VARCHAR DEFAULT NULL
)
RETURNS SETOF hotel_industry.find_nearby_hotels_result AS $$
BEGIN
    RETURN QUERY
    SELECT
        h.id,
        ST_Distance(h.coordinates::geometry, search_location::geometry),
        h.name,
        h.description,
        h.address,
        h.location_area,
        h.coordinates
    FROM hotel_industry.hotels AS h
    WHERE h.coordinates IS NOT NULL
      AND ST_DWithin(
          h.coordinates::geometry,
          search_location::geometry,
          radius_meters
      )
      AND (location_area IS NULL OR h.location_area = location_area)
    ORDER BY 2;
END;
$$ LANGUAGE plpgsql STABLE;
