-- SafeTrust demo seed users
-- id must be TEXT (Firebase UID format), not UUID
-- On conflict: skip — safe for repeated seed apply runs

INSERT INTO public.users (
    id,
    firebase_uid,
    email,
    first_name,
    last_name,
    last_seen
)
VALUES
    ('demo-uid-001', 'demo-uid-001', 'maria.rodriguez@example.com', 'Maria', 'Rodriguez', '2024-12-10T19:30:00Z'),
    ('demo-uid-002', 'demo-uid-002', 'carlos.jimenez@example.com', 'Carlos', 'Jimenez', '2024-12-10T18:30:00Z'),
    ('demo-uid-003', 'demo-uid-003', 'ana.castro@example.com', 'Ana', 'Castro', '2024-12-09T15:30:00Z'),
    ('demo-uid-004', 'demo-uid-004', 'roberto.mora@example.com', 'Roberto', 'Mora', '2024-12-08T14:30:00Z'),
    ('demo-uid-005', 'demo-uid-005', 'laura.vargas@example.com', 'Laura', 'Vargas', '2024-12-07T13:30:00Z'),
    ('demo-uid-006', 'demo-uid-006', 'pedro.solano@example.com', 'Pedro', 'Solano', '2024-12-06T12:30:00Z'),
    ('demo-uid-007', 'demo-uid-007', 'sofia.mendez@example.com', 'Sofia', 'Mendez', '2024-12-05T11:30:00Z'),
    ('demo-uid-008', 'demo-uid-008', 'diego.campos@example.com', 'Diego', 'Campos', '2024-12-04T10:30:00Z'),
    ('demo-uid-009', 'demo-uid-009', 'carmen.rojas@example.com', 'Carmen', 'Rojas', '2024-12-03T09:30:00Z'),
    ('demo-uid-010', 'demo-uid-010', 'miguel.herrera@example.com', 'Miguel', 'Herrera', '2024-12-02T08:30:00Z'),
    ('demo-uid-011', 'demo-uid-011', 'julia.martinez@example.com', 'Julia', 'Martinez', '2024-12-01T07:30:00Z'),
    ('demo-uid-012', 'demo-uid-012', 'thomas.mueller@example.com', 'Thomas', 'Mueller', '2024-11-30T06:30:00Z'),
    ('demo-uid-013', 'demo-uid-013', 'sarah.johnson@example.com', 'Sarah', 'Johnson', '2024-11-29T05:30:00Z'),
    ('demo-uid-014', 'demo-uid-014', 'lucas.silva@example.com', 'Lucas', 'Silva', '2024-11-28T04:30:00Z'),
    ('demo-uid-015', 'demo-uid-015', 'emma.brown@example.com', 'Emma', 'Brown', '2024-11-27T03:30:00Z'),
    ('demo-uid-016', 'demo-uid-016', 'antoine.dupont@example.com', 'Antoine', 'Dupont', '2024-11-26T02:30:00Z'),
    ('demo-uid-017', 'demo-uid-017', 'sofia.garcia@example.com', 'Sofia', 'Garcia', '2024-11-25T01:30:00Z'),
    ('demo-uid-018', 'demo-uid-018', 'marco.rossi@example.com', 'Marco', 'Rossi', '2024-11-24T00:30:00Z'),
    ('demo-uid-019', 'demo-uid-019', 'anna.kowalski@example.com', 'Anna', 'Kowalski', '2024-11-23T23:30:00Z'),
    ('demo-uid-020', 'demo-uid-020', 'james.wilson@example.com', 'James', 'Wilson', '2024-11-22T22:30:00Z'),
    ('demo-uid-021', 'demo-uid-021', 'hans.schmidt@example.com', 'Hans', 'Schmidt', '2024-11-21T21:30:00Z'),
    ('demo-uid-022', 'demo-uid-022', 'marie.dubois@example.com', 'Marie', 'Dubois', '2024-11-20T20:30:00Z'),
    ('demo-uid-023', 'demo-uid-023', 'alessandro.conti@example.com', 'Alessandro', 'Conti', '2024-11-19T19:30:00Z'),
    ('demo-uid-024', 'demo-uid-024', 'isabel.santos@example.com', 'Isabel', 'Santos', '2024-11-18T18:30:00Z'),
    ('demo-uid-025', 'demo-uid-025', 'john.smith@example.com', 'John', 'Smith', '2024-11-17T17:30:00Z')
ON CONFLICT (id) DO NOTHING;