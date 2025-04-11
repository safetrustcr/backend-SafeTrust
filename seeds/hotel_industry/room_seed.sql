CREATE EXTENSION IF NOT EXISTS "uuid-ossp";



-- Insert sample hotels
INSERT INTO hotels (id, name, description, address, location_area) VALUES
    (uuid_generate_v4(), 'Grand Hotel', 'Luxury hotel in the city', '123 Main St', 'Downtown'),
    (uuid_generate_v4(), 'Cozy Inn', 'Small and comfortable', '456 Elm St', 'Suburb');

-- Insert sample rooms
INSERT INTO rooms (hotel_id, room_number, room_type, price_night, status, capacity)
SELECT id, '101', 'Deluxe', 120.50, TRUE, 2 FROM hotels WHERE name = 'Grand Hotel'
UNION ALL
SELECT id, '102', 'Standard', 80.00, TRUE, 2 FROM hotels WHERE name = 'Grand Hotel'
UNION ALL
SELECT id, '201', 'Suite', 200.00, TRUE, 4 FROM hotels WHERE name = 'Cozy Inn';
