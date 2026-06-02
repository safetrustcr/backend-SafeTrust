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
    )
ON CONFLICT (id) DO NOTHING;