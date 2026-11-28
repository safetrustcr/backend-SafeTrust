INSERT INTO hotel_industry.escrow_transaction_users (
    user_id, escrow_transaction_id, role, status, is_primary
)
SELECT
    users.id,
    escrows.id,
    seeded.role,
    seeded.status,
    seeded.is_primary
FROM (
    VALUES
        ('alice.renter@example.com', 'contract-1', 'RENTER', 'ACTIVE', true),
        ('bob.owner@example.com', 'contract-1', 'OWNER', 'ACTIVE', true),
        ('charlie.witness@example.com', 'contract-1', 'WITNESS', 'PENDING', false),
        ('diana.renter@example.com', 'contract-2', 'RENTER', 'CONFIRMED', true),
        ('bob.owner@example.com', 'contract-2', 'OWNER', 'ACTIVE', true),
        ('alice.renter@example.com', 'contract-3', 'RENTER', 'FAILED', true),
        ('bob.owner@example.com', 'contract-3', 'OWNER', 'ACTIVE', true),
        ('diana.renter@example.com', 'contract-4', 'RENTER', 'PENDING', true),
        ('bob.owner@example.com', 'contract-4', 'OWNER', 'ACTIVE', true)
) AS seeded(user_email, contract_id, role, status, is_primary)
JOIN hotel_industry.users users ON users.email = seeded.user_email
JOIN hotel_industry.escrow_transactions escrows ON escrows.contract_id = seeded.contract_id
ON CONFLICT DO NOTHING;
