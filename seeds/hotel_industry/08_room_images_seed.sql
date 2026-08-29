CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.room_images (room_id, image_url, uploaded_at)
VALUES
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800', '2024-07-15 10:30:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=800', '2024-07-15 10:35:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800', '2024-07-15 10:40:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800', '2024-07-16 14:20:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel' LIMIT 1) LIMIT 1), 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800', '2024-07-16 14:25:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1),    'https://images.unsplash.com/photo-1568495248636-6432b97bd949?w=800', '2024-07-18 09:15:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1),    'https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=800', '2024-07-18 09:20:00+00'),
  ((SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn' LIMIT 1) LIMIT 1),    'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800', '2024-07-18 09:25:00+00')
ON CONFLICT DO NOTHING;