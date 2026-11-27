-- SafeTrust demo apartments seed
-- Canonical source: dApp-SafeTrust/infra/hasura/seeds/safetrust/02_apartments_seed.sql
-- Owner lookup uses firebase_uid for stable cross-seed references

-- Idempotency: upsert the demo apartments by id. They are not deleted and
-- reinserted because safetrust.reservations references apartments with
-- ON DELETE RESTRICT, so a delete fails once the reservations seed has run
-- (any bin/start without --reset). Upserting keeps dependent reservations,
-- conversations and escrows intact while refreshing the apartment values.

-- Apartment 1
INSERT INTO safetrust.apartments (
    id,
    owner_id,
    name,
    description,
    bedrooms,
    bathrooms,
    capacity,
    max_guests,
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
    2,
    2,
    4,
    4,
    1200.00,
    2400.00,
    point(-84.0807, 9.9282),
    '{"street": "Avenida Central", "neighborhood": "Centro", "city": "San José", "country": "Costa Rica"}',
    true,
    NOW() - INTERVAL '2 months',
    NOW() + INTERVAL '10 months'
FROM safetrust.users u WHERE u.firebase_uid = 'demo-owner-uid-002'
ON CONFLICT (id) DO UPDATE SET
    owner_id         = EXCLUDED.owner_id,
    name             = EXCLUDED.name,
    description      = EXCLUDED.description,
    bedrooms         = EXCLUDED.bedrooms,
    bathrooms        = EXCLUDED.bathrooms,
    capacity         = EXCLUDED.capacity,
    max_guests       = EXCLUDED.max_guests,
    price            = EXCLUDED.price,
    warranty_deposit = EXCLUDED.warranty_deposit,
    coordinates      = EXCLUDED.coordinates,
    address          = EXCLUDED.address,
    is_available     = EXCLUDED.is_available,
    available_from   = EXCLUDED.available_from,
    available_until  = EXCLUDED.available_until;

-- Apartment 2
INSERT INTO safetrust.apartments (
    id,
    owner_id,
    name,
    description,
    bedrooms,
    bathrooms,
    capacity,
    max_guests,
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
    1,
    1,
    2,
    2,
    950.00,
    1900.00,
    point(-84.0907, 9.9382),
    '{"street": "Calle 42", "neighborhood": "Sabana Norte", "city": "San José", "country": "Costa Rica"}',
    true,
    NOW() - INTERVAL '1 month',
    NOW() + INTERVAL '12 months'
FROM safetrust.users u WHERE u.firebase_uid = 'demo-owner-uid-002'
ON CONFLICT (id) DO UPDATE SET
    owner_id         = EXCLUDED.owner_id,
    name             = EXCLUDED.name,
    description      = EXCLUDED.description,
    bedrooms         = EXCLUDED.bedrooms,
    bathrooms        = EXCLUDED.bathrooms,
    capacity         = EXCLUDED.capacity,
    max_guests       = EXCLUDED.max_guests,
    price            = EXCLUDED.price,
    warranty_deposit = EXCLUDED.warranty_deposit,
    coordinates      = EXCLUDED.coordinates,
    address          = EXCLUDED.address,
    is_available     = EXCLUDED.is_available,
    available_from   = EXCLUDED.available_from,
    available_until  = EXCLUDED.available_until;