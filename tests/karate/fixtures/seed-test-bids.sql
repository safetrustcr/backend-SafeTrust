-- Seed test bid requests
DELETE FROM public.bid_requests WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.bid_requests (
    id, apartment_id, tenant_id, current_status, 
    proposed_price, desired_move_in
) VALUES
(
    '11111111-1111-1111-1111-111111111111', 
    '00000000-0000-0000-0000-000000000001', 
    'tenant-456', 
    'PENDING', 
    4800.00, 
    NOW() + INTERVAL '1 month'
);
