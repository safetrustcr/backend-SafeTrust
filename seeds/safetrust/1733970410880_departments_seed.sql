CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
) VALUES 
-- Maria Rodriguez's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'maria.rodriguez@example.com'),
    'Moderno Apartamento en San José Centro',
    'Apartamento renovado con acabados de lujo, 2 habitaciones, 2 baños, cerca del Parque Nacional',
    1200.00,
    2400.00,
    point(-84.0807, 9.9282),
    ST_GeomFromText('POLYGON((-84.0820 9.9270, -84.0790 9.9270, -84.0790 9.9290, -84.0820 9.9290, -84.0820 9.9270))', 4326),
    '{"street": "Avenida Central", "neighborhood": "Centro", "city": "San José", "country": "Costa Rica", "postal_code": "10101"}',
    true,
    NOW() - INTERVAL '2 months',
    NOW() + INTERVAL '10 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'maria.rodriguez@example.com'),
    'Suite Ejecutiva Sabana Norte',
    'Suite perfecta para ejecutivos, amueblada, con gimnasio y piscina en el edificio',
    950.00,
    1900.00,
    point(-84.0907, 9.9382),
    ST_GeomFromText('POLYGON((-84.0920 9.9370, -84.0890 9.9370, -84.0890 9.9390, -84.0920 9.9390, -84.0920 9.9370))', 4326),
    '{"street": "Calle 42", "neighborhood": "Sabana Norte", "city": "San José", "country": "Costa Rica", "postal_code": "10108"}',
    true,
    NOW() - INTERVAL '1 month',
    NOW() + INTERVAL '12 months'
),

-- Carlos Jiménez's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carlos.jimenez@example.com'),
    'Penthouse de Lujo en Escazú',
    'Espectacular penthouse con vista panorámica, 3 habitaciones, terraza privada y acabados de lujo',
    2500.00,
    5000.00,
    point(-84.1307, 9.9182),
    ST_GeomFromText('POLYGON((-84.1320 9.9170, -84.1290 9.9170, -84.1290 9.9190, -84.1320 9.9190, -84.1320 9.9170))', 4326),
    '{"street": "Avenida Escazú", "neighborhood": "San Rafael", "city": "Escazú", "country": "Costa Rica", "postal_code": "10203"}',
    true,
    NOW(),
    NOW() + INTERVAL '24 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carlos.jimenez@example.com'),
    'Apartamento Familiar en Santa Ana',
    'Amplio apartamento con jardín, 3 habitaciones, área de juegos y seguridad 24/7',
    1800.00,
    3600.00,
    point(-84.1507, 9.9282),
    ST_GeomFromText('POLYGON((-84.1520 9.9270, -84.1490 9.9270, -84.1490 9.9290, -84.1520 9.9290, -84.1520 9.9270))', 4326),
    '{"street": "Valle del Sol", "neighborhood": "Pozos", "city": "Santa Ana", "country": "Costa Rica", "postal_code": "10903"}',
    true,
    NOW() + INTERVAL '1 month',
    NOW() + INTERVAL '18 months'
),

-- Ana Castro's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'ana.castro@example.com'),
    'Estudio Moderno en Heredia Centro',
    'Acogedor estudio completamente amueblado, ideal para estudiantes o profesionales',
    600.00,
    1200.00,
    point(-84.1107, 9.9982),
    ST_GeomFromText('POLYGON((-84.1120 9.9970, -84.1090 9.9970, -84.1090 9.9990, -84.1120 9.9990, -84.1120 9.9970))', 4326),
    '{"street": "Calle 4", "neighborhood": "Centro", "city": "Heredia", "country": "Costa Rica", "postal_code": "40101"}',
    true,
    NOW() - INTERVAL '2 weeks',
    NOW() + INTERVAL '6 months'
),

-- Roberto Mora's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'roberto.mora@example.com'),
    'Apartamento Estudiantil en Cartago',
    'Cerca del TEC, 2 habitaciones, internet de alta velocidad, área de estudio',
    450.00,
    900.00,
    point(-83.9107, 9.8482),
    ST_GeomFromText('POLYGON((-83.9120 9.8470, -83.9090 9.8470, -83.9090 9.8490, -83.9120 9.8490, -83.9120 9.8470))', 4326),
    '{"street": "Calle 15", "neighborhood": "Oriental", "city": "Cartago", "country": "Costa Rica", "postal_code": "30101"}',
    true,
    NOW(),
    NOW() + INTERVAL '12 months'
),

-- Laura Vargas's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'laura.vargas@example.com'),
    'Suite Frente al Mar en Jacó',
    'Hermosa vista al océano, amueblado, piscina, acceso directo a la playa',
    1100.00,
    2200.00,
    point(-84.6307, 9.6182),
    ST_GeomFromText('POLYGON((-84.6320 9.6170, -84.6290 9.6170, -84.6290 9.6190, -84.6320 9.6190, -84.6320 9.6170))', 4326),
    '{"street": "Avenida Pastor Díaz", "neighborhood": "Centro", "city": "Jacó", "country": "Costa Rica", "postal_code": "61101"}',
    true,
    NOW() + INTERVAL '2 weeks',
    NOW() + INTERVAL '8 months'
),

-- Pedro Solano's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'pedro.solano@example.com'),
    'Apartamento Ejecutivo San Pedro',
    'Cerca de la UCR, moderno, 2 habitaciones, seguridad 24/7',
    900.00,
    1800.00,
    point(-84.0507, 9.9382),
    ST_GeomFromText('POLYGON((-84.0520 9.9370, -84.0490 9.9370, -84.0490 9.9390, -84.0520 9.9390, -84.0520 9.9370))', 4326),
    '{"street": "Calle 57", "neighborhood": "Los Yoses", "city": "San Pedro", "country": "Costa Rica", "postal_code": "11501"}',
    true,
    NOW() - INTERVAL '1 week',
    NOW() + INTERVAL '15 months'
),

-- Sofía Méndez's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'sofia.mendez@example.com'),
    'Loft Amueblado Santa Ana',
    'Diseño moderno, completamente equipado, cerca de Forum 2',
    1300.00,
    2600.00,
    point(-84.1807, 9.9282),
    ST_GeomFromText('POLYGON((-84.1820 9.9270, -84.1790 9.9270, -84.1790 9.9290, -84.1820 9.9290, -84.1820 9.9270))', 4326),
    '{"street": "Avenida 8", "neighborhood": "Forum", "city": "Santa Ana", "country": "Costa Rica", "postal_code": "10901"}',
    true,
    NOW() + INTERVAL '1 month',
    NOW() + INTERVAL '24 months'
),

-- Diego Campos's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'diego.campos@example.com'),
    'Vista Montaña Heredia',
    'Espectacular vista, 3 habitaciones, terraza, área verde',
    1100.00,
    2200.00,
    point(-84.1207, 9.9782),
    ST_GeomFromText('POLYGON((-84.1220 9.9770, -84.1190 9.9770, -84.1190 9.9790, -84.1220 9.9790, -84.1220 9.9770))', 4326),
    '{"street": "Calle Monte Verde", "neighborhood": "San Francisco", "city": "Heredia", "country": "Costa Rica", "postal_code": "40104"}',
    true,
    NOW() - INTERVAL '3 days',
    NOW() + INTERVAL '18 months'
),

-- Carmen Rojas's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carmen.rojas@example.com'),
    'Apartamento Familiar Alajuela',
    'Cerca del City Mall, 3 habitaciones, áreas comunes',
    850.00,
    1700.00,
    point(-84.2107, 10.0182),
    ST_GeomFromText('POLYGON((-84.2120 10.0170, -84.2090 10.0170, -84.2090 10.0190, -84.2120 10.0190, -84.2120 10.0170))', 4326),
    '{"street": "Calle Central", "neighborhood": "Centro", "city": "Alajuela", "country": "Costa Rica", "postal_code": "20101"}',
    true,
    NOW() + INTERVAL '2 months',
    NOW() + INTERVAL '24 months'
),

-- Miguel Herrera's properties
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'miguel.herrera@example.com'),
    'Eco Apartamento Monteverde',
    'Diseño sostenible, paneles solares, recolección de agua lluvia',
    950.00,
    1900.00,
    point(-84.8107, 10.3182),
    ST_GeomFromText('POLYGON((-84.8120 10.3170, -84.8090 10.3170, -84.8090 10.3190, -84.8120 10.3190, -84.8120 10.3170))', 4326),
    '{"street": "Calle Monteverde", "neighborhood": "Centro", "city": "Monteverde", "country": "Costa Rica", "postal_code": "60109"}',
    true,
    NOW() + INTERVAL '1 month',
    NOW() + INTERVAL '36 months'
),

-- Additional properties from various owners
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'maria.rodriguez@example.com'),
    'Mini Apartamento San José',
    'Ideal para solteros, ubicación céntrica, todos los servicios',
    500.00,
    1000.00,
    point(-84.0707, 9.9382),
    ST_GeomFromText('POLYGON((-84.0720 9.9370, -84.0690 9.9370, -84.0690 9.9390, -84.0720 9.9390, -84.0720 9.9370))', 4326),
    '{"street": "Paseo Colón", "neighborhood": "Centro", "city": "San José", "country": "Costa Rica", "postal_code": "10103"}',
    true,
    NOW(),
    NOW() + INTERVAL '12 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carlos.jimenez@example.com'),
    'Luxury Condo Escazú',
    'Ultra lujo, servicio de concierge, vista panorámica',
    3000.00,
    6000.00,
    point(-84.1407, 9.9282),
    ST_GeomFromText('POLYGON((-84.1420 9.9270, -84.1390 9.9270, -84.1390 9.9290, -84.1420 9.9290, -84.1420 9.9270))', 4326),
    '{"street": "Trejos Montealegre", "neighborhood": "Escazú", "city": "San José", "country": "Costa Rica", "postal_code": "10201"}',
    true,
    NOW() + INTERVAL '3 months',
    NOW() + INTERVAL '24 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'ana.castro@example.com'),
    'Student Housing Heredia',
    'Perfecto para estudiantes, cerca de la UNA',
    400.00,
    800.00,
    point(-84.1157, 9.9982),
    ST_GeomFromText('POLYGON((-84.1170 9.9970, -84.1140 9.9970, -84.1140 9.9990, -84.1170 9.9990, -84.1170 9.9970))', 4326),
    '{"street": "Avenida 3", "neighborhood": "UNA", "city": "Heredia", "country": "Costa Rica", "postal_code": "40101"}',
    true,
    NOW() - INTERVAL '1 month',
    NOW() + INTERVAL '6 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'roberto.mora@example.com'),
    'TEC Student Apartment',
    'Apartamento compartido cerca del TEC',
    350.00,
    700.00,
    point(-83.9157, 9.8482),
    ST_GeomFromText('POLYGON((-83.9170 9.8470, -83.9140 9.8470, -83.9140 9.8490, -83.9170 9.8490, -83.9170 9.8470))', 4326),
    '{"street": "Calle TEC", "neighborhood": "TEC", "city": "Cartago", "country": "Costa Rica", "postal_code": "30101"}',
    true,
    NOW(),
    NOW() + INTERVAL '12 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'laura.vargas@example.com'),
    'Oceanfront Studio Jacó',
    'Estudio frente al mar, perfecto para vacaciones',
    800.00,
    1600.00,
    point(-84.6357, 9.6182),
    ST_GeomFromText('POLYGON((-84.6370 9.6170, -84.6340 9.6170, -84.6340 9.6190, -84.6370 9.6190, -84.6370 9.6170))', 4326),
    '{"street": "Calle Bohío", "neighborhood": "Jacó Beach", "city": "Jacó", "country": "Costa Rica", "postal_code": "61101"}',
    true,
    NOW(),
    NOW() + INTERVAL '6 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'pedro.solano@example.com'),
    'UCR Student Loft',
    'Loft moderno cerca de la UCR, ideal para estudiantes',
    600.00,
    1200.00,
    point(-84.0527, 9.9382),
    ST_GeomFromText('POLYGON((-84.0540 9.9370, -84.0510 9.9370, -84.0510 9.9390, -84.0540 9.9390, -84.0540 9.9370))', 4326),
    '{"street": "Calle UCR", "neighborhood": "San Pedro", "city": "San José", "country": "Costa Rica", "postal_code": "11501"}',
    true,
    NOW(),
    NOW() + INTERVAL '12 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'sofia.mendez@example.com'),
    'Modern Studio Lindora',
    'Estudio ejecutivo en Lindora, cerca de Momentum',
    900.00,
    1800.00,
    point(-84.1827, 9.9582),
    ST_GeomFromText('POLYGON((-84.1840 9.9570, -84.1810 9.9570, -84.1810 9.9590, -84.1840 9.9590, -84.1840 9.9570))', 4326),
    '{"street": "Lindora", "neighborhood": "Santa Ana", "city": "San José", "country": "Costa Rica", "postal_code": "10901"}',
    true,
    NOW() + INTERVAL '1 month',
    NOW() + INTERVAL '24 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'diego.campos@example.com'),
    'Mountain View Condo',
    'Apartamento con vista a las montañas de Heredia',
    950.00,
    1900.00,
    point(-84.1227, 9.9782),
    ST_GeomFromText('POLYGON((-84.1240 9.9770, -84.1210 9.9770, -84.1210 9.9790, -84.1240 9.9790, -84.1240 9.9770))', 4326),
    '{"street": "Barreal", "neighborhood": "Heredia", "city": "Heredia", "country": "Costa Rica", "postal_code": "40104"}',
    true,
    NOW(),
    NOW() + INTERVAL '18 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carmen.rojas@example.com'),
    'Family Condo Alajuela',
    'Apartamento familiar cerca del aeropuerto',
    750.00,
    1500.00,
    point(-84.2127, 10.0182),
    ST_GeomFromText('POLYGON((-84.2140 10.0170, -84.2110 10.0170, -84.2110 10.0190, -84.2140 10.0190, -84.2140 10.0170))', 4326),
    '{"street": "El Coco", "neighborhood": "Alajuela", "city": "Alajuela", "country": "Costa Rica", "postal_code": "20101"}',
    true,
    NOW(),
    NOW() + INTERVAL '24 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'miguel.herrera@example.com'),
    'Eco Friendly Studio',
    'Estudio ecológico en Monteverde',
    700.00,
    1400.00,
    point(-84.8127, 10.3182),
    ST_GeomFromText('POLYGON((-84.8140 10.3170, -84.8110 10.3170, -84.8110 10.3190, -84.8140 10.3190, -84.8140 10.3170))', 4326),
    '{"street": "Santa Elena", "neighborhood": "Monteverde", "city": "Puntarenas", "country": "Costa Rica", "postal_code": "60109"}',
    true,
    NOW(),
    NOW() + INTERVAL '36 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'maria.rodriguez@example.com'),
    'Downtown Studio Plus',
    'Estudio plus en el centro de San José',
    650.00,
    1300.00,
    point(-84.0727, 9.9382),
    ST_GeomFromText('POLYGON((-84.0740 9.9370, -84.0710 9.9370, -84.0710 9.9390, -84.0740 9.9390, -84.0740 9.9370))', 4326),
    '{"street": "Avenida Segunda", "neighborhood": "Centro", "city": "San José", "country": "Costa Rica", "postal_code": "10103"}',
    true,
    NOW(),
    NOW() + INTERVAL '12 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carlos.jimenez@example.com'),
    'Executive Suite Escazú',
    'Suite ejecutiva en el corazón de Escazú',
    1500.00,
    3000.00,
    point(-84.1427, 9.9282),
    ST_GeomFromText('POLYGON((-84.1440 9.9270, -84.1410 9.9270, -84.1410 9.9290, -84.1440 9.9290, -84.1440 9.9270))', 4326),
    '{"street": "Multiplaza", "neighborhood": "Escazú", "city": "San José", "country": "Costa Rica", "postal_code": "10201"}',
    true,
    NOW(),
    NOW() + INTERVAL '24 months'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'ana.castro@example.com'),
    'University Studio Plus',
    'Estudio plus cerca de universidades',
    550.00,
    1100.00,
    point(-84.1177, 9.9982),
    ST_GeomFromText('POLYGON((-84.1190 9.9970, -84.1160 9.9970, -84.1160 9.9990, -84.1190 9.9990, -84.1190 9.9970))', 4326),
    '{"street": "UNA", "neighborhood": "Heredia", "city": "Heredia", "country": "Costa Rica", "postal_code": "40101"}',
    true,
    NOW(),
    NOW() + INTERVAL '6 months'
);