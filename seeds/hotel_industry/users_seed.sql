-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Insert sample users
INSERT INTO users (
    id, 
    email, 
    username, 
    password_hash, 
    is_active
) VALUES 
    (
        uuid_generate_v4(), 
        'john.doe@example.com', 
        'johndoe', 
        '$2a$10$randomhashvaluehere123', 
        true
    ),
    (
        uuid_generate_v4(), 
        'jane.smith@example.com', 
        'janesmith', 
        '$2a$10$anotherhashvalue456', 
        true
    ),
    (
        uuid_generate_v4(), 
        'alice.wonder@example.com', 
        'alicewonder', 
        '$2a$10$thirdhashvalue789', 
        true
    );

-- Insert corresponding users_wallets
-- Note: This assumes the previous INSERT created UUIDs we'll reference
WITH user_data AS (
    SELECT id, email 
    FROM users 
    ORDER BY random() 
    LIMIT 3
)
INSERT INTO users_wallets (
    user_id, 
    wallet_address, 
    chain_type, 
    is_primary
) VALUES 
    (
        (SELECT id FROM user_data WHERE email = 'john.doe@example.com'),
        '0x1234567890123456789012345678901234567890',
        'ethereum',
        true
    ),
    (
        (SELECT id FROM user_data WHERE email = 'jane.smith@example.com'),
        '0x0987654321098765432109876543210987654321',
        'polygon',
        true
    ),
    (
        (SELECT id FROM user_data WHERE email = 'alice.wonder@example.com'),
        '0x5555555555555555555555555555555555555555',
        'binance_smart_chain',
        true
    ),
    -- Add a secondary wallet for John
    (
        (SELECT id FROM user_data WHERE email = 'john.doe@example.com'),
        '0x6666666666666666666666666666666666666666',
        'arbitrum',
        false
    );

-- Verification Queries
SELECT 
    u.id AS user_id, 
    u.email, 
    uw.wallet_address, 
    uw.chain_type, 
    uw.is_primary
FROM 
    users u
JOIN 
    users_wallets uw ON u.id = uw.user_id;