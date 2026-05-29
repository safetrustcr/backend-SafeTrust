-- SafeTrust demo bid requests seed
-- Canonical source: dApp-SafeTrust/infra/hasura/seeds/safetrust/03_bid_requests_seed.sql
-- Depends on: 01_users_seed.sql, 02_apartments_seed.sql (must run after both)

-- Idempotency: remove demo bid requests before reinserting
DELETE FROM public.bid_requests
WHERE tenant_id IN (
    SELECT id FROM public.users
    WHERE firebase_uid = 'demo-tenant-uid-001'
);

-- Bid Request 1: PENDING on Apartment 1
INSERT INTO public.bid_requests (
    id,
    apartment_id,
    tenant_id,
    current_status,
    proposed_price,
    desired_move_in
)
SELECT
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    u.id,
    'PENDING',
    1150.00,
    NOW() + INTERVAL '1 month'
FROM public.users u WHERE u.firebase_uid = 'demo-tenant-uid-001'
ON CONFLICT (id) DO NOTHING;

-- Bid Request 2: CANCELLED on Apartment 2
INSERT INTO public.bid_requests (
    id,
    apartment_id,
    tenant_id,
    current_status,
    proposed_price,
    desired_move_in
)
SELECT
    '660e8400-e29b-41d4-a716-446655440002'::uuid,
    '550e8400-e29b-41d4-a716-446655440002'::uuid,
    u.id,
    'CANCELLED',
    900.00,
    NOW() + INTERVAL '2 months'
FROM public.users u WHERE u.firebase_uid = 'demo-tenant-uid-001'
ON CONFLICT (id) DO NOTHING;
