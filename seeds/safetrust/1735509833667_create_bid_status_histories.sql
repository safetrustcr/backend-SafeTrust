-- SafeTrust demo bid status histories seed
-- Depends on: 1734710839892_bid_requests_seed.sql (must run after bid_requests)

-- Idempotency: remove demo bid status histories before reinserting
DELETE FROM public.bid_status_histories
WHERE bid_request_id IN (
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440002'::uuid
);

-- Status history for Bid Request 1 (PENDING on Apartment 1)
INSERT INTO public.bid_status_histories (id, bid_request_id, status, notes, changed_by, created_at)
SELECT
    '770e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    'Submitted',
    'Bid request has been submitted.',
    u.id,
    NOW()
FROM public.users u WHERE u.firebase_uid = 'demo-tenant-uid-001'
ON CONFLICT (id) DO NOTHING;

-- Status history for Bid Request 2 (CANCELLED on Apartment 2) — entry 1: Submitted
INSERT INTO public.bid_status_histories (id, bid_request_id, status, notes, changed_by, created_at)
SELECT
    '770e8400-e29b-41d4-a716-446655440002'::uuid,
    '660e8400-e29b-41d4-a716-446655440002'::uuid,
    'Submitted',
    'Bid request has been submitted.',
    u.id,
    NOW() - INTERVAL '1 day'
FROM public.users u WHERE u.firebase_uid = 'demo-tenant-uid-001'
ON CONFLICT (id) DO NOTHING;

-- Status history for Bid Request 2 (CANCELLED on Apartment 2) — entry 2: Cancelled
INSERT INTO public.bid_status_histories (id, bid_request_id, status, notes, changed_by, created_at)
SELECT
    '770e8400-e29b-41d4-a716-446655440003'::uuid,
    '660e8400-e29b-41d4-a716-446655440002'::uuid,
    'Cancelled',
    'Bid request cancelled by tenant.',
    u.id,
    NOW()
FROM public.users u WHERE u.firebase_uid = 'demo-tenant-uid-001'
ON CONFLICT (id) DO NOTHING;
