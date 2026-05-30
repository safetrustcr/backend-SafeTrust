-- SafeTrust demo apartments seed
-- Canonical source: dApp-SafeTrust/infra/hasura/seeds/safetrust/02_apartments_seed.sql
-- Owner lookup uses firebase_uid for stable cross-seed references

-- Idempotency: remove demo apartments before reinserting
DELETE FROM public.apartments
WHERE owner_id IN (
    SELECT id FROM public.users
    WHERE firebase_uid IN ('demo-tenant-uid-001', 'demo-owner-uid-002')
);

-- Apartment 1
INSERT INTO public.apartments (
    id,
    owner_id,
    name,
    description,
    price,
    warranty_deposit,
    coordinates,
    address,
    is_available,
    available_from,
    available_until
)
SELECT
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    u.id,
    'Moderno Apartamento en San José Centro',
    'Apartamento renovado con acabados de lujo, 2 habitaciones, 2 baños',
    1200.00,
    2400.00,
    point(-84.0807, 9.9282),
    '{"street": "Avenida Central", "neighborhood": "Centro", "city": "San José", "country": "Costa Rica"}',
    true,
    NOW() - INTERVAL '2 months',
    NOW() + INTERVAL '10 months'
FROM public.users u WHERE u.firebase_uid = 'demo-owner-uid-002'
ON CONFLICT (id) DO NOTHING;

-- Apartment 2
INSERT INTO public.apartments (
    id,
    owner_id,
    name,
    description,
    price,
    warranty_deposit,
    coordinates,
    address,
    is_available,
    available_from,
    available_until
)
SELECT
    '550e8400-e29b-41d4-a716-446655440002'::uuid,
    u.id,
    'Suite Ejecutiva Sabana Norte',
    'Suite perfecta para ejecutivos, amueblada, con gimnasio y piscina',
    950.00,
    1900.00,
    point(-84.0907, 9.9382),
    '{"street": "Calle 42", "neighborhood": "Sabana Norte", "city": "San José", "country": "Costa Rica"}',
    true,
    NOW() - INTERVAL '1 month',
    NOW() + INTERVAL '12 months'
FROM public.users u WHERE u.firebase_uid = 'demo-owner-uid-002'
ON CONFLICT (id) DO NOTHING;