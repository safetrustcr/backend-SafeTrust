-- Escrow transaction 1 - Alice's reservation
INSERT INTO escrow_transactions (
    reservation_id,
    contract_id,
    escrow_status,
    signer_address,
    transaction_type,
    escrow_transaction_type,
    http_status_code
) VALUES (
    uuid_generate_v4(), 
    'contract-1',
    'PENDING',
    '0xAliceSignerAddress1234',
    'RENTAL',
    'ESCROW_INIT',
    200
);

-- Escrow transaction 2 - Diana's reservation, already confirmed
INSERT INTO escrow_transactions (
    reservation_id,
    contract_id,
    escrow_status,
    signer_address,
    transaction_type,
    escrow_transaction_type,
    http_status_code
) VALUES (
    uuid_generate_v4(),
    'contract-2',
    'CONFIRMED',
    '0xDianaSigner9876',
    'RENTAL',
    'ESCROW_CONFIRM',
    200
);

-- Escrow transaction 3 - Bob's reservation, with failed escrow
INSERT INTO escrow_transactions (
    reservation_id,
    contract_id,
    escrow_status,
    signer_address,
    transaction_type,
    escrow_transaction_type,
    http_status_code
) VALUES (
    uuid_generate_v4(),
    'contract-3',
    'FAILED',
    '0xBobSignerFail',
    'RENTAL',
    'ESCROW_FAIL',
    500
);

-- Escrow transaction 4 - Witness case, pending action
INSERT INTO escrow_transactions (
    reservation_id,
    contract_id,
    escrow_status,
    signer_address,
    transaction_type,
    escrow_transaction_type,
    http_status_code
) VALUES (
    uuid_generate_v4(),
    'contract-4',
    'PENDING',
    '0xWitnessSignerPending',
    'RENTAL',
    'ESCROW_INIT',
    102
);
