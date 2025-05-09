-- First, create the required users if they don't exist
INSERT INTO public.users (id, email, role)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'buyer1@example.com', 'user'),
    ('00000000-0000-0000-0000-000000000002', 'seller1@example.com', 'user'),
    ('00000000-0000-0000-0000-000000000003', 'buyer2@example.com', 'user'),
    ('00000000-0000-0000-0000-000000000004', 'seller2@example.com', 'user')
ON CONFLICT (id) DO NOTHING;

-- Then insert the escrow transaction user associations
INSERT INTO public.escrow_transaction_users (
    user_id,
    escrow_transaction_id,
    role,
    status,
    is_primary
) VALUES
    -- Sample data for transaction 1
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'buyer', 'active', true),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'seller', 'active', false),
    
    -- Sample data for transaction 2
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'buyer', 'active', true),
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'seller', 'active', false); 
