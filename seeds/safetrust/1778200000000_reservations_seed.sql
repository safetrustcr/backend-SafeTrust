-- seeds/safetrust/1778200000000_reservations_seed.sql
-- Seed for safetrust.reservations table
-- Covers all valid lifecycle statuses defined by valid_reservation_status CHECK constraint
-- Depends on: users seed, apartments seed, trustless_work_escrows seed (3 contracts available)
-- Note: each escrow_id must be unique — one escrow per reservation
-- Note: dates must not overlap per apartment — enforced by no_overlapping_reservations constraint

DELETE FROM safetrust.reservations
WHERE guest_id IN (
  'demo-tenant-uid-001',
  'demo-owner-uid-002',
  'demo-user-uid-003',
  'demo-user-uid-004',
  'demo-user-uid-005',
  'demo-user-uid-006',
  'demo-user-uid-007',
  'demo-user-uid-008'
);

-- 1. status: pending — apt 1, far future, no escrow yet
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-tenant-uid-001',
  NULL,
  NOW() + INTERVAL '60 days',
  NOW() + INTERVAL '67 days',
  2500.00, 'USDC', 'pending', 'safetrust'
);

-- 2. status: escrow_created — apt 2, far future, links to CAATN5DTEST00001
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-user-uid-003',
  (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00001'),
  NOW() + INTERVAL '70 days',
  NOW() + INTERVAL '77 days',
  1800.00, 'USDC', 'escrow_created', 'safetrust'
);

-- 3. status: funded — apt 1, near future, links to CAATN5DTEST00002
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-user-uid-004',
  (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00002'),
  NOW() + INTERVAL '10 days',
  NOW() + INTERVAL '17 days',
  3200.00, 'USDC', 'funded', 'safetrust'
);

-- 4. status: checked_in — apt 2, current stay, links to CAATN5DTEST00003
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-user-uid-005',
  (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00003'),
  NOW() - INTERVAL '2 days',
  NOW() + INTERVAL '5 days',
  2100.00, 'USDC', 'checked_in', 'safetrust'
);

-- 5. status: completed — apt 1, past stay, no escrow link needed
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-user-uid-006',
  NULL,
  NOW() - INTERVAL '40 days',
  NOW() - INTERVAL '33 days',
  2800.00, 'USDC', 'completed', 'safetrust'
);

-- 6. status: disputed — apt 2, past stay, no escrow link needed
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-user-uid-007',
  NULL,
  NOW() - INTERVAL '20 days',
  NOW() - INTERVAL '13 days',
  1900.00, 'USDC', 'disputed', 'safetrust'
);

-- 7. status: resolved — apt 1, older past stay, no escrow link needed
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-user-uid-008',
  NULL,
  NOW() - INTERVAL '60 days',
  NOW() - INTERVAL '53 days',
  3500.00, 'USDC', 'resolved', 'safetrust'
);

-- 8. status: cancelled — apt 2, future dates, no escrow needed
-- cancelled status is excluded from the overlap constraint
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-owner-uid-002',
  NULL,
  NOW() + INTERVAL '30 days',
  NOW() + INTERVAL '37 days',
  1500.00, 'USDC', 'cancelled', 'safetrust'
)
ON CONFLICT DO NOTHING;