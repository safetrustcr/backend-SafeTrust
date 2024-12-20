CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO bid_requests (
    id,
    apartment_id,
    tenant_id,
    current_status,
    proposed_price,
    desired_move_in
) VALUES 
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Moderno Apartamento en San José Centro'),
    (SELECT id FROM users WHERE email = 'julia.martinez@example.com'),
    'PENDING',
    1150.00,
    '2024-02-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Suite Ejecutiva Sabana Norte'),
    (SELECT id FROM users WHERE email = 'thomas.mueller@example.com'),
    'APPROVED',
    900.00,
    '2024-03-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Penthouse de Lujo en Escazú'),
    (SELECT id FROM users WHERE email = 'sarah.johnson@example.com'),
    'PENDING',
    2300.00,
    '2024-04-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Apartamento Familiar en Santa Ana'),
    (SELECT id FROM users WHERE email = 'lucas.silva@example.com'),
    'CANCELLED',
    1700.00,
    '2024-03-15T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Estudio Moderno en Heredia Centro'),
    (SELECT id FROM users WHERE email = 'emma.brown@example.com'),
    'APPROVED',
    580.00,
    '2024-02-15T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Apartamento Estudiantil en Cartago'),
    (SELECT id FROM users WHERE email = 'antoine.dupont@example.com'),
    'PENDING',
    425.00,
    '2024-05-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Suite Frente al Mar en Jacó'),
    (SELECT id FROM users WHERE email = 'sofia.garcia@example.com'),
    'APPROVED',
    1050.00,
    '2024-06-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Apartamento Ejecutivo San Pedro'),
    (SELECT id FROM users WHERE email = 'marco.rossi@example.com'),
    'PENDING',
    850.00,
    '2024-04-15T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Loft Amueblado Santa Ana'),
    (SELECT id FROM users WHERE email = 'anna.kowalski@example.com'),
    'CANCELLED',
    1200.00,
    '2024-03-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Vista Montaña Heredia'),
    (SELECT id FROM users WHERE email = 'james.wilson@example.com'),
    'APPROVED',
    1050.00,
    '2024-07-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Apartamento Familiar Alajuela'),
    (SELECT id FROM users WHERE email = 'hans.schmidt@example.com'),
    'PENDING',
    800.00,
    '2024-05-15T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Eco Apartamento Monteverde'),
    (SELECT id FROM users WHERE email = 'marie.dubois@example.com'),
    'APPROVED',
    900.00,
    '2024-06-15T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Mini Apartamento San José'),
    (SELECT id FROM users WHERE email = 'alessandro.conti@example.com'),
    'PENDING',
    480.00,
    '2024-04-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Luxury Condo Escazú'),
    (SELECT id FROM users WHERE email = 'isabel.santos@example.com'),
    'CANCELLED',
    2800.00,
    '2024-08-01T10:00:00Z'
),
(
    uuid_generate_v4(),
    (SELECT id FROM apartments WHERE name = 'Student Housing Heredia'),
    (SELECT id FROM users WHERE email = 'john.smith@example.com'),
    'APPROVED',
    380.00,
    '2024-03-01T10:00:00Z'
);