INSERT INTO reservations (
    reservation_id, 
    wallet_address, 
    room_id, 
    check_in, 
    check_out, 
    capacity, 
    reservation_status, 
    total_amount
) VALUES

-- CONFIRMED reservations (upcoming stays)
(
    uuid_generate_v4(), 
    '0x1a2b3c4d5e6f7g8h9i0j1234567890abcdef', 
    '00000000-0000-0000-0000-000000000101', 
    '2024-08-15 15:00:00+00', 
    '2024-08-18 11:00:00+00', 
    2, 
    'CONFIRMED', 
    361.50
),
(
    uuid_generate_v4(), 
    '0x2b3c4d5e6f7g8h9i0j2345678901bcdef23', 
    '00000000-0000-0000-0000-000000000205', 
    '2024-08-22 15:00:00+00', 
    '2024-08-25 11:00:00+00', 
    4, 
    'CONFIRMED', 
    675.00
),
(
    uuid_generate_v4(), 
    '0x3c4d5e6f7g8h9i0j3456789012cdef3456', 
    '00000000-0000-0000-0000-000000000301', 
    '2024-09-01 15:00:00+00', 
    '2024-09-03 11:00:00+00', 
    2, 
    'CONFIRMED', 
    520.00
),

-- PENDING reservations
(
    uuid_generate_v4(), 
    '0x4d5e6f7g8h9i0j4567890123def45678', 
    '00000000-0000-0000-0000-000000000102', 
    '2024-08-28 15:00:00+00', 
    '2024-08-30 11:00:00+00', 
    2, 
    'PENDING', 
    160.00
),
(
    uuid_generate_v4(), 
    '0x5e6f7g8h9i0j567890124ef567890ab', 
    '00000000-0000-0000-0000-000000000203', 
    '2024-09-05 15:00:00+00', 
    '2024-09-08 11:00:00+00', 
    3, 
    'PENDING', 
    456.00
),
(
    uuid_generate_v4(), 
    '0x6f7g8h9i0j67890125f67890abcd123', 
    '00000000-0000-0000-0000-000000000104', 
    '2024-09-12 15:00:00+00', 
    '2024-09-14 11:00:00+00', 
    1, 
    'PENDING', 
    180.00
),

-- CANCELLED reservations
(
    uuid_generate_v4(), 
    '0x7g8h9i0j78901236890abcd1234567', 
    '00000000-0000-0000-0000-000000000201', 
    '2024-08-10 15:00:00+00', 
    '2024-08-12 11:00:00+00', 
    4, 
    'CANCELLED', 
    400.00
),
(
    uuid_generate_v4(), 
    '0x8h9i0j89012347901bcd23456789ab', 
    '00000000-0000-0000-0000-000000000302', 
    '2024-08-25 15:00:00+00', 
    '2024-08-27 11:00:00+00', 
    2, 
    'CANCELLED', 
    340.00
),

-- COMPLETED reservations
(
    uuid_generate_v4(), 
    '0x9i0j901234890123cd3456789abcdef', 
    '00000000-0000-0000-0000-000000000101', 
    '2024-07-01 15:00:00+00', 
    '2024-07-05 11:00:00+00', 
    2, 
    'COMPLETED', 
    482.00
),
(
    uuid_generate_v4(), 
    '0xa0j01234901234d456789abcdef123', 
    '00000000-0000-0000-0000-000000000103', 
    '2024-06-15 15:00:00+00', 
    '2024-06-18 11:00:00+00', 
    3, 
    'COMPLETED', 
    375.00
),
(
    uuid_generate_v4(), 
    '0xb01234901234e56789abcdef1234567', 
    '00000000-0000-0000-0000-000000000204', 
    '2024-07-20 15:00:00+00', 
    '2024-07-22 11:00:00+00', 
    2, 
    'COMPLETED', 
    280.00
),
(
    uuid_generate_v4(), 
    '0xc1234901234f6789abcdef12345678', 
    '00000000-0000-0000-0000-000000000303', 
    '2024-05-10 15:00:00+00', 
    '2024-05-15 11:00:00+00', 
    4, 
    'COMPLETED', 
    1250.00
);

-- Update the updated_at timestamp for variety in historical data
UPDATE reservations 
SET updated_at = created_at + INTERVAL '1 hour' 
WHERE reservation_status = 'COMPLETED';

UPDATE reservations 
SET updated_at = created_at + INTERVAL '30 minutes' 
WHERE reservation_status = 'CONFIRMED';

UPDATE reservations 
SET updated_at = created_at + INTERVAL '2 hours' 
WHERE reservation_status = 'CANCELLED';
