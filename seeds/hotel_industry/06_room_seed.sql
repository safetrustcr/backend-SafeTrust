CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

INSERT INTO hotel_industry.rooms (hotel_id, room_number, room_type_id, price_night, status, capacity)
SELECT
    h.id,
    '101',
    (SELECT id FROM hotel_industry.room_types WHERE name = 'Deluxe'),
    120.50, TRUE, 2
FROM hotel_industry.hotels h WHERE h.name = 'Grand Hotel'

UNION ALL

SELECT
    h.id,
    '102',
    (SELECT id FROM hotel_industry.room_types WHERE name = 'Standard'),
    80.00, TRUE, 2
FROM hotel_industry.hotels h WHERE h.name = 'Grand Hotel'

UNION ALL

SELECT
    h.id,
    '201',
    (SELECT id FROM hotel_industry.room_types WHERE name = 'Suite'),
    200.00, TRUE, 4
FROM hotel_industry.hotels h WHERE h.name = 'Cozy Inn'
ON CONFLICT DO NOTHING;