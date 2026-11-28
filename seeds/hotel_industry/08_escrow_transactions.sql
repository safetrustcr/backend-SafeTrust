-- seeds/hotel_industry/08_escrow_transactions.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.escrow_transactions (
    reservation_id, contract_id, escrow_status,
    signer_address, type
) VALUES
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel'))
       AND check_in = '2024-08-15 15:00:00+00'),
    'contract-1',
    'PENDING',
    'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX',
    'escrow'
  ),
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel'))
       AND check_in = '2024-08-28 15:00:00+00'),
    'contract-2',
    'FUNDED',
    'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27',
    'escrow'
  ),
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel'))
       AND check_in = '2024-09-01 15:00:00+00'),
    'contract-3',
    'FAILED',
    'GAZ6DAONCUZYNJLSYSBCCYD6DUEAKXSDSYZNZDENCCHNEIBDZ7QUKUNO',
    'escrow'
  ),
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn'))
       AND check_in = '2024-08-22 15:00:00+00'),
    'contract-4',
    'PENDING',
    'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27',
    'escrow'
  )
ON CONFLICT (contract_id) DO UPDATE SET
  reservation_id = COALESCE(EXCLUDED.reservation_id, hotel_industry.escrow_transactions.reservation_id),
  signer_address = EXCLUDED.signer_address,
  escrow_status = EXCLUDED.escrow_status,
  type = EXCLUDED.type;
