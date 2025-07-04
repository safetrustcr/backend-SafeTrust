CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
-- Create users_wallets table with relationship to users table
CREATE TABLE IF NOT EXISTS users_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    chain_type VARCHAR(50) NOT NULL, -- Changed from DATE to VARCHAR for blockchain network type
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key constraint
    CONSTRAINT fk_users_wallets_user_id FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,
    
    -- Unique constraint on wallet address
    CONSTRAINT users_wallets_address_unique UNIQUE (wallet_address)
);

-- Create indexes for performance
CREATE INDEX idx_users_wallets_user_id ON users_wallets(user_id);
CREATE INDEX idx_users_wallets_wallet_address ON users_wallets(wallet_address);
CREATE INDEX idx_users_wallets_is_primary ON users_wallets(is_primary);
