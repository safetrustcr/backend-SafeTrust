-- Create escrow_transaction_users table to track participants and their funding status
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE escrow_transaction_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_transaction_id UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'buyer', 'seller', 'arbitrator', etc.
    funding_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'funded', 'failed'
    amount NUMERIC(20, 7) NOT NULL,
    funded_at TIMESTAMP WITH TIME ZONE,
    blockchain_tx_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_escrow_user_role UNIQUE (escrow_transaction_id, user_id, role),
    CONSTRAINT valid_funding_status CHECK (funding_status IN ('pending', 'funded', 'failed', 'refunded'))
);

-- Indexes for fast queries
CREATE INDEX idx_escrow_transaction_users_escrow_id ON escrow_transaction_users(escrow_transaction_id);
CREATE INDEX idx_escrow_transaction_users_user_id ON escrow_transaction_users(user_id);
CREATE INDEX idx_escrow_transaction_users_funding_status ON escrow_transaction_users(funding_status);
CREATE INDEX idx_escrow_transaction_users_created_at ON escrow_transaction_users(created_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_escrow_transaction_users_updated_at
    BEFORE UPDATE ON escrow_transaction_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE escrow_transaction_users IS 'Tracks participants in escrow transactions and their funding status';
COMMENT ON COLUMN escrow_transaction_users.funding_status IS 'Status of user funding: pending, funded, failed, or refunded';
COMMENT ON COLUMN escrow_transaction_users.role IS 'Role of the user in the escrow: buyer, seller, arbitrator, etc.';
