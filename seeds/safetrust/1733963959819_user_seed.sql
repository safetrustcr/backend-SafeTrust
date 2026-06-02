-- SafeTrust demo seed users
-- id must be TEXT (Firebase UID format), not UUID
-- On conflict: skip — safe for repeated seed apply runs

INSERT INTO public.users (
    id,
    firebase_uid,
    email,
    first_name,
    last_name,
    phone_number,
    country_code,
    location,
    last_seen
)
VALUES
    (
        'demo-tenant-uid-001',
        'demo-tenant-uid-001',
        'john_s@gmail.com',
        'John',
        'Smith',
        '88001122',
        '+506',
        'San José, Costa Rica',
        NOW()
    ),
    (
        'demo-owner-uid-002',
        'demo-owner-uid-002',
        'albertoCasas100@gmail.com',
        'Alberto',
        'Casas',
        '88003344',
        '+506',
        'Escazú, Costa Rica',
        NOW()
    ),
    (
        'demo-user-uid-003',
        'demo-user-uid-003',
        'maria.rodriguez@example.com',
        'María',
        'Rodríguez',
        '88005566',
        '+506',
        'San José, Costa Rica',
        NOW()
    ),
    (
        'demo-user-uid-004',
        'demo-user-uid-004',
        'ana.castro@example.com',
        'Ana',
        'Castro',
        '88007788',
        '+506',
        'San José, Costa Rica',
        NOW()
    ),
    (
        'demo-user-uid-005',
        'demo-user-uid-005',
        'pedro.solano@example.com',
        'Pedro',
        'Solano',
        '88009900',
        '+506',
        'San José, Costa Rica',
        NOW()
    ),
    (
        'demo-user-uid-006',
        'demo-user-uid-006',
        'carlos.jimenez@example.com',
        'Carlos',
        'Jiménez',
        '88001133',
        '+506',
        'San José, Costa Rica',
        NOW()
    ),
    (
        'demo-user-uid-007',
        'demo-user-uid-007',
        'roberto.mora@example.com',
        'Roberto',
        'Mora',
        '88002244',
        '+506',
        'San José, Costa Rica',
        NOW()
    ),
    (
        'demo-user-uid-008',
        'demo-user-uid-008',
        'laura.vargas@example.com',
        'Laura',
        'Vargas',
        '88003355',
        '+506',
        'San José, Costa Rica',
        NOW()
    )
ON CONFLICT (id) DO NOTHING;