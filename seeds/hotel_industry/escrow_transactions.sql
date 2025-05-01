CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- SET search_path TO public;

-- Insert sample data into the escrow_transactions table
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
    (
        uuid_generate_v4(), 
        uuid_generate_v4(), 
        'contract_001', 
        '0x123abc', 
        'CREATE_ESCROW', 
        'CREATE_ESCROW', 
        'PENDING', 
        200
    );
