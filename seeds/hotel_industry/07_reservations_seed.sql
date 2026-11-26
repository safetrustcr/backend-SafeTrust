CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.reservations (
    id, reservation_id, wallet_address, room_id,
    check_in, check_out, capacity, reservation_status, total_amount
) VALUES
  -- 1: Grand Hotel Room 101 (120.50/night) * 3 nights = 361.50, cap 2
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701', 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-08-15 15:00:00+00', '2024-08-18 11:00:00+00', 2, 'CONFIRMED', 361.50),
  -- 2: Cozy Inn Room 201 (200.00/night) * 3 nights = 600.00, cap 4
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000702', 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn')),    '2024-08-22 15:00:00+00', '2024-08-25 11:00:00+00', 4, 'CONFIRMED', 600.00),
  -- 3: Grand Hotel Room 102 (80.00/night) * 2 nights = 160.00, cap 2
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000703', 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-09-01 15:00:00+00', '2024-09-03 11:00:00+00', 2, 'CONFIRMED', 160.00),
  -- 4: Grand Hotel Room 101 (120.50/night) * 2 nights = 241.00, cap 2
  ('00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000704', 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-08-28 15:00:00+00', '2024-08-30 11:00:00+00', 2, 'PENDING',   241.00),
  -- 5: Cozy Inn Room 201 (200.00/night) * 3 nights = 600.00, cap 3 (room cap 4)
  ('00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000705', 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn')),    '2024-09-05 15:00:00+00', '2024-09-08 11:00:00+00', 3, 'PENDING',   600.00),
  -- 6: Grand Hotel Room 102 (80.00/night) * 2 nights = 160.00, cap 1 (room cap 2)
  ('00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000706', 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-09-12 15:00:00+00', '2024-09-14 11:00:00+00', 1, 'PENDING',   160.00),
  -- 7: Cozy Inn Room 201 (200.00/night) * 2 nights = 400.00, cap 4
  ('00000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000707', 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn')),    '2024-08-10 15:00:00+00', '2024-08-12 11:00:00+00', 4, 'CANCELLED', 400.00),
  -- 8: Grand Hotel Room 102 (80.00/night) * 2 nights = 160.00, cap 2
  ('00000000-0000-4000-8000-000000000708', '00000000-0000-4000-8000-000000000708', 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-08-25 15:00:00+00', '2024-08-27 11:00:00+00', 2, 'CANCELLED', 160.00),
  -- 9: Grand Hotel Room 101 (120.50/night) * 4 nights = 482.00, cap 2
  ('00000000-0000-4000-8000-000000000709', '00000000-0000-4000-8000-000000000709', 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-07-01 15:00:00+00', '2024-07-05 11:00:00+00', 2, 'COMPLETED', 482.00),
  -- 10: Grand Hotel Room 102 (80.00/night) * 3 nights = 240.00, cap 2 (adjusted to fit room capacity 2)
  ('00000000-0000-4000-8000-000000000710', '00000000-0000-4000-8000-000000000710', 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-06-15 15:00:00+00', '2024-06-18 11:00:00+00', 2, 'COMPLETED', 240.00),
  -- 11: Cozy Inn Room 201 (200.00/night) * 2 nights = 400.00, cap 2 (room cap 4)
  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000711', 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn')),    '2024-07-20 15:00:00+00', '2024-07-22 11:00:00+00', 2, 'COMPLETED', 400.00),
  -- 12: Grand Hotel Room 101 (120.50/night) * 5 nights = 602.50, cap 2 (adjusted to fit room capacity 2)
  ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000712', 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel')), '2024-05-10 15:00:00+00', '2024-05-15 11:00:00+00', 2, 'COMPLETED', 602.50)
ON CONFLICT (id) DO UPDATE SET
  reservation_id = EXCLUDED.reservation_id,
  wallet_address = EXCLUDED.wallet_address,
  room_id = EXCLUDED.room_id,
  check_in = EXCLUDED.check_in,
  check_out = EXCLUDED.check_out,
  capacity = EXCLUDED.capacity,
  reservation_status = EXCLUDED.reservation_status,
  total_amount = EXCLUDED.total_amount;

UPDATE hotel_industry.reservations SET updated_at = created_at + INTERVAL '1 hour'      WHERE reservation_status = 'COMPLETED';
UPDATE hotel_industry.reservations SET updated_at = created_at + INTERVAL '30 minutes'  WHERE reservation_status = 'CONFIRMED';
UPDATE hotel_industry.reservations SET updated_at = created_at + INTERVAL '2 hours'     WHERE reservation_status = 'CANCELLED';

-- Link escrow transactions to reservations deterministically
UPDATE hotel_industry.escrow_transactions
SET reservation_id = '00000000-0000-4000-8000-000000000701'
WHERE contract_id = 'contract-1';

UPDATE hotel_industry.escrow_transactions
SET reservation_id = '00000000-0000-4000-8000-000000000704'
WHERE contract_id = 'contract-2';

UPDATE hotel_industry.escrow_transactions
SET reservation_id = '00000000-0000-4000-8000-000000000703'
WHERE contract_id = 'contract-3';

UPDATE hotel_industry.escrow_transactions
SET reservation_id = '00000000-0000-4000-8000-000000000702'
WHERE contract_id = 'contract-4';
