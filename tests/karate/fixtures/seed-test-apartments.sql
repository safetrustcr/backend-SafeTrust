-- Seed test apartments
TRUNCATE public.apartments CASCADE;

INSERT INTO public.apartments (
    id, owner_id, name, description, price, warranty_deposit, 
    coordinates, address, is_available, available_from, 
    bedrooms, pet_friendly, category
) VALUES
(
    '00000000-0000-0000-0000-000000000001', 
    'owner-123', 
    'Luxury Villa in San José', 
    'Beautiful villa with pool', 
    5000.00, 10000.00, 
    POINT(9.9281, -84.0907), 
    '{"street": "Main St", "city": "San José", "country": "Costa Rica"}', 
    true, NOW(), 
    3, true, 'Villa'
),
(
    '00000000-0000-0000-0000-000000000002', 
    'owner-123', 
    'Cozy Apartment', 
    'Perfect for singles', 
    1500.00, 3000.00, 
    POINT(9.9333, -84.0833), 
    '{"street": "2nd Ave", "city": "San José", "country": "Costa Rica"}', 
    true, NOW(), 
    1, false, 'Apartment'
),
(
    '00000000-0000-0000-0000-000000000003', 
    'owner-123', 
    'Beach House', 
    'Near the ocean', 
    3500.00, 7000.00, 
    POINT(9.6500, -84.3333), 
    '{"street": "Ocean Dr", "city": "Jaco", "country": "Costa Rica"}', 
    true, NOW(), 
    2, true, 'House'
);
