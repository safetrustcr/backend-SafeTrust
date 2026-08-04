CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.escrow_transaction_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email VARCHAR(150) REFERENCES hotel_industry.users(email),
    escrow_transaction_id UUID REFERENCES hotel_industry.escrow_transactions(id),
    role VARCHAR(20),
    status VARCHAR(20),
    is_primary BOOLEAN DEFAULT false,
    funded_at TIMESTAMPTZ,
    funding_status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_hotel_escrow_user_role
        UNIQUE (escrow_transaction_id, user_email, role)
);

CREATE INDEX IF NOT EXISTS idx_hotel_escrow_tx_users_tx_id
    ON hotel_industry.escrow_transaction_users(escrow_transaction_id);
CREATE INDEX IF NOT EXISTS idx_hotel_escrow_tx_users_email
    ON hotel_industry.escrow_transaction_users(user_email);
CREATE INDEX IF NOT EXISTS idx_hotel_escrow_tx_users_funding_status
    ON hotel_industry.escrow_transaction_users(funding_status);