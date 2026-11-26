-- seeds/hotel_industry/02_escrow_transactions.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.escrow_transactions (
    reservation_id, contract_id, escrow_status,
    signer_address, transaction_type, escrow_transaction_type, http_status_code
) VALUES
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel'))
       AND check_in = '2024-08-15 15:00:00+00'),
    'contract-1',
    'PENDING',
    'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX',
    'RENTAL',
    'ESCROW_INIT',
    200
  ),
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '101' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel'))
       AND check_in = '2024-08-28 15:00:00+00'),
    'contract-2',
    'CONFIRMED',
    'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27',
    'RENTAL',
    'ESCROW_CONFIRM',
    200
  ),
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '102' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Grand Hotel'))
       AND check_in = '2024-09-01 15:00:00+00'),
    'contract-3',
    'FAILED',
    'GAZ6DAONCUZYNJLSYSBCCYD6DUEAKXSDSYZNZDENCCHNEIBDZ7QUKUNO',
    'RENTAL',
    'ESCROW_FAIL',
    500
  ),
  (
    (SELECT id FROM hotel_industry.reservations
     WHERE room_id = (SELECT room_id FROM hotel_industry.rooms WHERE room_number = '201' AND hotel_id = (SELECT id FROM hotel_industry.hotels WHERE name = 'Cozy Inn'))
       AND check_in = '2024-08-22 15:00:00+00'),
    'contract-4',
    'PENDING',
    'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27',
    'RENTAL',
    'ESCROW_INIT',
    102
  )
ON CONFLICT (contract_id) DO UPDATE SET
  reservation_id = COALESCE(EXCLUDED.reservation_id, hotel_industry.escrow_transactions.reservation_id),
  signer_address = EXCLUDED.signer_address,
  escrow_status = EXCLUDED.escrow_status,
  transaction_type = EXCLUDED.transaction_type,
  escrow_transaction_type = EXCLUDED.escrow_transaction_type,
  http_status_code = EXCLUDED.http_status_code;
