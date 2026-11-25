DROP FUNCTION IF EXISTS hotel_industry.find_nearby_hotels(
    POINT,
    DOUBLE PRECISION,
    CHARACTER VARYING
);

DROP INDEX IF EXISTS hotel_industry.idx_hotels_location_area;

ALTER TABLE hotel_industry.hotels
    ALTER COLUMN name TYPE TEXT,
    ALTER COLUMN description TYPE TEXT,
    ADD COLUMN address_line TEXT,
    ADD COLUMN city TEXT,
    ADD COLUMN neighborhood TEXT,
    ADD COLUMN country_code CHAR(2);

UPDATE hotel_industry.hotels
SET address_line = CASE
        WHEN POSITION(',' IN address) > 0
            THEN BTRIM(REGEXP_REPLACE(address, ',[^,]*$', ''))
        ELSE address
    END,
    city = CASE
        WHEN POSITION(',' IN address) > 0
            THEN NULLIF(BTRIM(REVERSE(SPLIT_PART(REVERSE(address), ',', 1))), '')
        ELSE NULL
    END,
    neighborhood = location_area;

ALTER TABLE hotel_industry.hotels
    ALTER COLUMN address_line SET NOT NULL,
    DROP COLUMN address,
    DROP COLUMN location_area,
    ADD CONSTRAINT hotels_name_length
        CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 120),
    ADD CONSTRAINT hotels_description_length
        CHECK (description IS NULL OR CHAR_LENGTH(description) <= 2000);

CREATE INDEX idx_hotels_neighborhood
    ON hotel_industry.hotels(neighborhood);
