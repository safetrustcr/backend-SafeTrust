-- Room Images seed data for hotel_industry tenant
-- This file populates the room_images table with sample data for testing and development

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Insert all room images in a single statement
INSERT INTO room_images (room_id, image_url, uploaded_at)
VALUES
-- Images for Grand Hotel Room 101 (Deluxe)
((SELECT room_id FROM rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800', 
 '2024-07-15 10:30:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=800', 
 '2024-07-15 10:35:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800', 
 '2024-07-15 10:40:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800', 
 '2024-07-15 10:45:00+00'),

-- Images for Grand Hotel Room 102 (Standard)
((SELECT room_id FROM rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800', 
 '2024-07-16 14:20:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800', 
 '2024-07-16 14:25:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800', 
 '2024-07-16 14:30:00+00'),

-- Images for Cozy Inn Room 201 (Suite)
((SELECT room_id FROM rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1568495248636-6432b97bd949?w=800', 
 '2024-07-18 09:15:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=800', 
 '2024-07-18 09:20:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800', 
 '2024-07-18 09:25:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800', 
 '2024-07-18 09:30:00+00'),

((SELECT room_id FROM rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1), 
 'https://images.unsplash.com/photo-1568495248636-6432b97bd949?w=800', 
 '2024-07-18 09:35:00+00'); 