-- migrations/hotel_industry/1743029389869_create_users_wallets_table/up.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.users_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    chain_type VARCHAR(50) NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT fk_hotel_users_wallets_user_id FOREIGN KEY (user_id)
        REFERENCES hotel_industry.users(id) ON DELETE CASCADE,

    CONSTRAINT hotel_users_wallets_address_unique UNIQUE (wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_hotel_users_wallets_user_id
    ON hotel_industry.users_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_hotel_users_wallets_wallet_address
    ON hotel_industry.users_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_hotel_users_wallets_is_primary
    ON hotel_industry.users_wallets(is_primary);