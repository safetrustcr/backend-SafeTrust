-- Alice as RENTER in escrow for contract-1
INSERT INTO escrow_transaction_users (
    user_email,
    escrow_transaction_id,
    role,
    status,
    is_primary
) VALUES (
    'alice.renter@example.com',
    'contract-1',
    'RENTER',
    'ACTIVE',
    true
);

-- Bob as OWNER in escrow for contract-1
INSERT INTO escrow_transaction_users (
    user_email,
    escrow_transaction_id,
    role,
    status,
    is_primary
) VALUES (
    (SELECT email FROM users WHERE email = 'bob.owner@example.com'),
    (SELECT contract_id FROM escrow_transactions WHERE contract_id = 'contract-1'),
    'OWNER',
    'ACTIVE',
    true
);

-- Charlie as WITNESS in escrow for contract-1
INSERT INTO escrow_transaction_users (
    user_email,
    escrow_transaction_id,
    role,
    status,
    is_primary
) VALUES (
    (SELECT email FROM users WHERE email = 'charlie.witness@example.com'),
    (SELECT contract_id FROM escrow_transactions WHERE contract_id = 'contract-1'),
    'WITNESS',
    'PENDING',
    false
);

-- Diana as RENTER in escrow for contract-2
INSERT INTO escrow_transaction_users (
    user_email,
    escrow_transaction_id,
    role,
    status,
    is_primary
) VALUES (
    (SELECT email FROM users WHERE email = 'diana.renter@example.com'),
    (SELECT contract_id FROM escrow_transactions WHERE contract_id = 'contract-2'),
    'RENTER',
    'CONFIRMED',
    true
);
