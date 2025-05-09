INSERT INTO escrow_transactions (
    escrow_transaction_id, 
    reservation_id, 
    contract_id, 
    signer_address, 
    transaction_type, 
    escrow_transaction_type, 
    escrow_status,
    http_status_code
) 
VALUES 
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_001', '0x123abc', 'CREATE_ESCROW', 'CREATE_ESCROW', 'PENDING', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_002', '0x456def', 'RELEASE_ESCROW', 'RELEASE_ESCROW', 'COMPLETED', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_003', '0x789ghi', 'CANCEL_ESCROW', 'CANCEL_ESCROW', 'CANCELED', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_004', '0xabc123', 'CREATE_ESCROW', 'CREATE_ESCROW', 'FAILED', 500),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_005', '0xdef456', 'RELEASE_ESCROW', 'RELEASE_ESCROW', 'PENDING', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_006', '0xghi789', 'CREATE_ESCROW', 'CREATE_ESCROW', 'ACTIVE', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_007', '0x123jkl', 'CANCEL_ESCROW', 'CANCEL_ESCROW', 'CANCELED', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_008', '0x456mno', 'RELEASE_ESCROW', 'RELEASE_ESCROW', 'COMPLETED', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_009', '0x789pqr', 'CREATE_ESCROW', 'CREATE_ESCROW', 'PENDING', 200),
    (uuid_generate_v4(), uuid_generate_v4(), 'contract_010', '0xabcstu', 'RELEASE_ESCROW', 'RELEASE_ESCROW', 'FAILED', 500);