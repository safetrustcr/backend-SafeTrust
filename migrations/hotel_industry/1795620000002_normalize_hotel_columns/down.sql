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
    RENAME COLUMN neighborhood TO location_area,
    DROP COLUMN address_line,
    DROP COLUMN city,
    DROP COLUMN country_code;

CREATE INDEX idx_hotels_location_area
    ON hotel_industry.hotels(location_area);
