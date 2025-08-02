CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO rooms (hotel_id, room_number, room_type_id, price_night, status, capacity)
SELECT 
    h.id, 
    '101', 
    (SELECT id FROM room_types WHERE name = 'Deluxe'), 
    120.50, 
    TRUE, 
    2 
FROM hotels h WHERE h.name = 'Grand Hotel'

UNION ALL

SELECT 
    h.id, 
    '102', 
    (SELECT id FROM room_types WHERE name = 'Standard'), 
    80.00, 
    TRUE, 
    2 
FROM hotels h WHERE h.name = 'Grand Hotel'

UNION ALL

SELECT 
    h.id, 
    '201', 
    (SELECT id FROM room_types WHERE name = 'Suite'), 
    200.00, 
    TRUE, 
    4 
FROM hotels h WHERE h.name = 'Cozy Inn';
