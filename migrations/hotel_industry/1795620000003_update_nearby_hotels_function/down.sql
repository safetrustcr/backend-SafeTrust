DROP FUNCTION IF EXISTS hotel_industry.find_nearby_hotels(
    POINT,
    DOUBLE PRECISION,
    TEXT
);
DROP TABLE hotel_industry.find_nearby_hotels_result;

CREATE TABLE hotel_industry.find_nearby_hotels_result (
    id UUID,
    distance FLOAT,
    name VARCHAR(20),
    description VARCHAR(50),
    address VARCHAR(50),
    hotel_area VARCHAR(20),
    coordinates POINT
);

DROP FUNCTION hotel_industry.get_top_rooms_by_reservations(VARCHAR, VARCHAR);
ALTER TABLE hotel_industry.get_top_rooms_by_reservations_result
    ALTER COLUMN hotel_name TYPE VARCHAR(20)
        USING LEFT(hotel_name, 20)::VARCHAR(20);

CREATE FUNCTION hotel_industry.get_top_rooms_by_reservations(
    time_period VARCHAR DEFAULT 'all',
    filter_status VARCHAR DEFAULT NULL
)
RETURNS SETOF hotel_industry.get_top_rooms_by_reservations_result AS $$
DECLARE
    date_filter TIMESTAMPTZ;
BEGIN
    IF time_period NOT IN ('week', 'month', 'year', 'all') THEN
        RAISE EXCEPTION 'Invalid time_period. Must be one of: week, month, year, all';
    END IF;

    CASE time_period
        WHEN 'week'  THEN date_filter := NOW() - INTERVAL '1 week';
        WHEN 'month' THEN date_filter := NOW() - INTERVAL '1 month';
        WHEN 'year'  THEN date_filter := NOW() - INTERVAL '1 year';
        ELSE              date_filter := '1970-01-01'::TIMESTAMPTZ;
    END CASE;

    RETURN QUERY
    SELECT
        r.id,
        r.room_number,
        LEFT(h.name, 20)::VARCHAR(20) AS hotel_name,
        COUNT(res.id) AS reservation_count,
        COALESCE(SUM(res.total_amount), 0)::NUMERIC(12,2) AS total_revenue
    FROM hotel_industry.rooms r
    INNER JOIN hotel_industry.hotels h ON r.hotel_id = h.id
    LEFT JOIN hotel_industry.reservations res ON r.id = res.room_id
        AND res.created_at >= date_filter
        AND (filter_status IS NULL OR res.reservation_status = filter_status)
    GROUP BY r.id, r.room_number, h.name
    HAVING COUNT(res.id) > 0
    ORDER BY reservation_count DESC, total_revenue DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;
