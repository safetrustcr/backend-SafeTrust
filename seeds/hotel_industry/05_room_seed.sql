CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO rooms (hotel_id, room_number, room_type, price_night, status, capacity)
SELECT 
    h.id, 
    '101', 
    (SELECT type_id FROM room_types WHERE type_name = 'Deluxe'), 
    120.50, 
    TRUE, 
    2 
FROM hotels h WHERE h.name = 'Grand Hotel'

UNION ALL

SELECT 
    h.id, 
    '102', 
    (SELECT type_id FROM room_types WHERE type_name = 'Standard'), 
    80.00, 
    TRUE, 
    2 
FROM hotels h WHERE h.name = 'Grand Hotel'

UNION ALL

SELECT 
    h.id, 
    '201', 
    (SELECT type_id FROM room_types WHERE type_name = 'Suite'), 
    200.00, 
    TRUE, 
    4 
FROM hotels h WHERE h.name = 'Cozy Inn';
