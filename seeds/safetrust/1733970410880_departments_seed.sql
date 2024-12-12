INSERT INTO apartments (
    id, 
    owner_id, 
    name, 
    description, 
    price, 
    warranty_deposit, 
    coordinates, 
    location_area,
    address,
    is_available,
    available_from,
    available_until
) VALUES (
    uuid_generate_v4(), 
    (SELECT id FROM users WHERE email = 'john.doe@example.com'), 
    'Modern Loft in Heredia', 
    'Spacious and bright loft in the heart of San José, perfect for professionals and digital nomads.', 
    1250.00, 
    2500.00, 
    point(-84.0907, 9.9282),  
    ST_GeomFromText('POLYGON((-84.0920 9.9270, -84.0890 9.9270, -84.0890 9.9290, -84.0920 9.9290, -84.0920 9.9270))', 4326),
    '{"street": "Calle 5", "neighborhood": "Barrio Escalante", "city": "San José", "country": "Costa Rica", "postal_code": "10103"}',
    true,
    NOW() - INTERVAL '1 month',
    NOW() + INTERVAL '6 months'
),
(
 uuid_generate_v4(),
 (SELECT id FROM users WHERE email = 'john.doe@example.com'),
 'Modern Loft in San Jose',
 'Spacious and bright loft in the heart of San José, perfect for professionals and digital nomads',
 1250.00,
 2500.00, 
 point(-84.0907, 9.9282),
 ST_GeomFromText('POLYGON((-84.0920 9.9270, -84.0890 9.9270, -84.0890 9.9290, -84.0920 9.9290, -84.0920 9.9270))', 4326),
 '{"street": "Calle 5", "neighborhood": "Barrio Escalante", "city": "San José", "country": "Costa Rica", "postal_code": "10103"}',
 true,
 NOW() - INTERVAL '1 month',
 NOW() + INTERVAL '6 months'
);

