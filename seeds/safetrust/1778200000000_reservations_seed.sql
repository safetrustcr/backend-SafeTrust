-- seeds/safetrust/1778200000000_reservations_seed.sql
-- Seed for public.reservations table
-- Covers all valid lifecycle statuses defined by valid_reservation_status CHECK constraint
-- Depends on: users seed, apartments seed, trustless_work_escrows seed (3 contracts available)

-- Idempotency: remove demo reservations before reinserting
DELETE FROM public.reservations
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

-- 1. status: pending — guest hit BOOK, no escrow yet
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-tenant-uid-001',
  NULL,
  NOW() + INTERVAL '7 days',
  NOW() + INTERVAL '14 days',
  2500.00, 'USDC', 'pending', 'safetrust'
);

-- 2. status: escrow_created — links to CAATN5DTEST00001 (milestone_approved)
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-user-uid-003',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00001'),
  NOW() + INTERVAL '14 days',
  NOW() + INTERVAL '21 days',
  1800.00, 'USDC', 'escrow_created', 'safetrust'
);

-- 3. status: funded — links to CAATN5DTEST00002 (funded)
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-user-uid-004',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00002'),
  NOW() + INTERVAL '3 days',
  NOW() + INTERVAL '10 days',
  3200.00, 'USDC', 'funded', 'safetrust'
);

-- 4. status: checked_in — links to CAATN5DTEST00001 (milestone_approved)
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-user-uid-005',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00001'),
  NOW() - INTERVAL '2 days',
  NOW() + INTERVAL '5 days',
  2100.00, 'USDC', 'checked_in', 'safetrust'
);

-- 5. status: completed — links to CAATN5DTEST00003 (completed)
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-user-uid-006',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00003'),
  NOW() - INTERVAL '30 days',
  NOW() - INTERVAL '23 days',
  2800.00, 'USDC', 'completed', 'safetrust'
);

-- 6. status: disputed — links to CAATN5DTEST00002 (funded — active escrow that can be disputed)
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-user-uid-007',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00002'),
  NOW() - INTERVAL '10 days',
  NOW() - INTERVAL '3 days',
  1900.00, 'USDC', 'disputed', 'safetrust'
);

-- 7. status: resolved — links to CAATN5DTEST00003 (completed)
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-user-uid-008',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00003'),
  NOW() - INTERVAL '45 days',
  NOW() - INTERVAL '38 days',
  3500.00, 'USDC', 'resolved', 'safetrust'
);

-- 8. status: cancelled — no escrow needed
INSERT INTO public.reservations (
  id, apartment_id, guest_id, escrow_id,
  check_in_date, check_out_date,
  total_amount, asset_code, status, tenant_id
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-owner-uid-002',
  NULL,
  NOW() + INTERVAL '20 days',
  NOW() + INTERVAL '27 days',
  1500.00, 'USDC', 'cancelled', 'safetrust'
);