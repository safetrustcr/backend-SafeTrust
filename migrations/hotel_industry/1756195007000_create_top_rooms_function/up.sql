CREATE OR REPLACE FUNCTION hotel_industry.get_top_rooms_by_reservations(
    time_period VARCHAR DEFAULT 'all',
    filter_status VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    room_id UUID,
    room_number VARCHAR(5),
    hotel_name VARCHAR(20),
    reservation_count BIGINT,
    total_revenue NUMERIC(12,2)
) AS $$
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
        r.room_id,
        r.room_number,
        h.name AS hotel_name,
        COUNT(res.id) AS reservation_count,
        COALESCE(SUM(res.total_amount), 0) AS total_revenue
    FROM hotel_industry.rooms r
    INNER JOIN hotel_industry.hotels h ON r.hotel_id = h.id
    LEFT JOIN hotel_industry.reservations res ON r.room_id = res.room_id
        AND res.created_at >= date_filter
        AND (filter_status IS NULL OR res.reservation_status = filter_status)
    GROUP BY r.room_id, r.room_number, h.name
    HAVING COUNT(res.id) > 0
    ORDER BY reservation_count DESC, total_revenue DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;