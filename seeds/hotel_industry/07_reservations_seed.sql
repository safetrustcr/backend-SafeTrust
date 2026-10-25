CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.reservations (
    reservation_id, wallet_address, room_id,
    check_in, check_out, capacity, reservation_status, total_amount
) VALUES
  (uuid_generate_v4(), '0x1a2b3c4d', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' LIMIT 1), '2024-08-15 15:00:00+00', '2024-08-18 11:00:00+00', 2, 'CONFIRMED', 361.50),
  (uuid_generate_v4(), '0x2b3c4d5e', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' LIMIT 1), '2024-08-22 15:00:00+00', '2024-08-25 11:00:00+00', 4, 'CONFIRMED', 675.00),
  (uuid_generate_v4(), '0x3c4d5e6f', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' LIMIT 1), '2024-09-01 15:00:00+00', '2024-09-03 11:00:00+00', 2, 'CONFIRMED', 520.00),
  (uuid_generate_v4(), '0x4d5e6f7g', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' LIMIT 1), '2024-08-28 15:00:00+00', '2024-08-30 11:00:00+00', 2, 'PENDING',   160.00),
  (uuid_generate_v4(), '0x5e6f7g8h', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' LIMIT 1), '2024-09-05 15:00:00+00', '2024-09-08 11:00:00+00', 3, 'PENDING',   456.00),
  (uuid_generate_v4(), '0x6f7g8h9i', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' LIMIT 1), '2024-09-12 15:00:00+00', '2024-09-14 11:00:00+00', 1, 'PENDING',   180.00),
  (uuid_generate_v4(), '0x7g8h9i0j', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' LIMIT 1), '2024-08-10 15:00:00+00', '2024-08-12 11:00:00+00', 4, 'CANCELLED', 400.00),
  (uuid_generate_v4(), '0x8h9i0j1k', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' LIMIT 1), '2024-08-25 15:00:00+00', '2024-08-27 11:00:00+00', 2, 'CANCELLED', 340.00),
  (uuid_generate_v4(), '0x9i0j1k2l', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' LIMIT 1), '2024-07-01 15:00:00+00', '2024-07-05 11:00:00+00', 2, 'COMPLETED', 482.00),
  (uuid_generate_v4(), '0xa0j1k2l3', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' LIMIT 1), '2024-06-15 15:00:00+00', '2024-06-18 11:00:00+00', 3, 'COMPLETED', 375.00),
  (uuid_generate_v4(), '0xb1k2l3m4', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' LIMIT 1), '2024-07-20 15:00:00+00', '2024-07-22 11:00:00+00', 2, 'COMPLETED', 280.00),
  (uuid_generate_v4(), '0xc2l3m4n5', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' LIMIT 1), '2024-05-10 15:00:00+00', '2024-05-15 11:00:00+00', 4, 'COMPLETED', 1250.00)
ON CONFLICT DO NOTHING;

UPDATE hotel_industry.reservations SET updated_at = created_at + INTERVAL '1 hour'      WHERE reservation_status = 'COMPLETED';
UPDATE hotel_industry.reservations SET updated_at = created_at + INTERVAL '30 minutes'  WHERE reservation_status = 'CONFIRMED';
UPDATE hotel_industry.reservations SET updated_at = created_at + INTERVAL '2 hours'     WHERE reservation_status = 'CANCELLED';