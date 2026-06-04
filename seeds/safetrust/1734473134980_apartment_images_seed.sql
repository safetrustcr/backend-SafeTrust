-- SafeTrust demo apartment images seed
-- References apartments by stable UUID to avoid fragile name-based lookups
-- Canonical apartment UUIDs are defined in 1733970410880_apartments_seed.sql

-- Ensure UUID extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Idempotency: clear existing demo images before re-inserting
DELETE FROM public.apartment_images
WHERE apartment_id IN (
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440002'::uuid
);

-- Images for Apartment 1: 'Moderno Apartamento en San José Centro'
INSERT INTO apartment_images (id, apartment_id, image_url, uploaded_at)
VALUES
    (uuid_generate_v4(), '550e8400-e29b-41d4-a716-446655440001',
     'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-1.jpg', NOW()),
    (uuid_generate_v4(), '550e8400-e29b-41d4-a716-446655440001',
     'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-10-810x540.jpg', NOW()),
    (uuid_generate_v4(), '550e8400-e29b-41d4-a716-446655440001',
     'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-9-810x531.jpg', NOW());

-- Images for Apartment 2: 'Suite Ejecutiva Sabana Norte'
INSERT INTO apartment_images (id, apartment_id, image_url, uploaded_at)
VALUES
    (uuid_generate_v4(), '550e8400-e29b-41d4-a716-446655440002',
     'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-22-810x540.jpg', NOW()),
    (uuid_generate_v4(), '550e8400-e29b-41d4-a716-446655440002',
     'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-18-810x540.jpg', NOW()),
    (uuid_generate_v4(), '550e8400-e29b-41d4-a716-446655440002',
     'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-21-810x540.jpg', NOW());
