CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO bid_requests (
    id,
    apartment_id,
    tenant_id,
    current_status,
    proposed_price,
    desired_move_in
) VALUES 
(uuid_generate_v4(), (SELECT id FROM apartments WHERE name = 'Modern Loft in Heredia'), (SELECT id FROM users WHERE email = 'john.doe@example.com'), 'PENDING', 1950.00, '2024-02-01T10:00:00Z');