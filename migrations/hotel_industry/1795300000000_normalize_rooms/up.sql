DO $$
DECLARE
  invalid_capacity_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO invalid_capacity_count
  FROM hotel_industry.rooms
  WHERE capacity <= 0;

  IF invalid_capacity_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add rooms capacity constraint: % existing room(s) have capacity <= 0',
      invalid_capacity_count;
  END IF;
END;
$$;

DROP FUNCTION hotel_industry.get_top_rooms_by_reservations(VARCHAR, VARCHAR);
DROP TABLE hotel_industry.get_top_rooms_by_reservations_result;

ALTER TABLE hotel_industry.rooms
  RENAME COLUMN room_id TO id;

ALTER TABLE hotel_industry.rooms
  ADD COLUMN is_active BOOLEAN;

UPDATE hotel_industry.rooms
SET is_active = COALESCE(status, TRUE);

ALTER TABLE hotel_industry.rooms
  ALTER COLUMN is_active SET DEFAULT TRUE,
  ALTER COLUMN is_active SET NOT NULL,
  DROP COLUMN status,
  ADD CONSTRAINT rooms_capacity_positive CHECK (capacity > 0);

ALTER TABLE hotel_industry.reservations
  DROP CONSTRAINT reservations_room_id_fkey,
  ADD CONSTRAINT reservations_room_id_fkey
    FOREIGN KEY (room_id)
    REFERENCES hotel_industry.rooms(id)
    ON DELETE SET NULL;

CREATE TABLE hotel_industry.get_top_rooms_by_reservations_result (
  id UUID,
  room_number VARCHAR(5),
  hotel_name VARCHAR(20),
  reservation_count BIGINT,
  total_revenue NUMERIC(12,2)
);

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
    WHEN 'week' THEN date_filter := NOW() - INTERVAL '1 week';
    WHEN 'month' THEN date_filter := NOW() - INTERVAL '1 month';
    WHEN 'year' THEN date_filter := NOW() - INTERVAL '1 year';
    ELSE date_filter := '1970-01-01'::TIMESTAMPTZ;
  END CASE;

  RETURN QUERY
  SELECT
    r.id,
    r.room_number,
    h.name AS hotel_name,
    COUNT(res.id) AS reservation_count,
    COALESCE(SUM(res.total_amount), 0) AS total_revenue
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

COMMENT ON COLUMN hotel_industry.rooms.is_active IS
  'Whether the room may be offered for new bookings. Existing reservations remain valid when false.';
