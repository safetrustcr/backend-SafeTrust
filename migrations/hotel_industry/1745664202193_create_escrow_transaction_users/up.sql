CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create the escrow_transaction_users table
CREATE TABLE escrow_transaction_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email VARCHAR(150) REFERENCES users(email),
    escrow_transaction_id TEXT REFERENCES escrow_transactions(contract_id),
    role VARCHAR(20),
    status VARCHAR(20),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_escrow_user_role UNIQUE (escrow_transaction_id, user_email, role)
);

-- Add a column to store the payload sent to TrustlessWork fund-escrow API
ALTER TABLE escrow_transactions
ADD COLUMN fund_payload JSONB;

-- Extend escrow_transaction_users to track funding status per user
ALTER TABLE escrow_transaction_users
ADD COLUMN funded_at TIMESTAMPTZ,
ADD COLUMN funding_status VARCHAR(20) DEFAULT 'PENDING';

-- Create an index for faster lookups
CREATE INDEX idx_escrow_transaction_users_transaction_id ON escrow_transaction_users(escrow_transaction_id);
CREATE INDEX idx_escrow_transaction_users_user_id ON escrow_transaction_users(user_email); 
CREATE INDEX idx_escrow_transaction_users_funding_status ON escrow_transaction_users(funding_status);