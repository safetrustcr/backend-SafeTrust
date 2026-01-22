-- Create blockchain_transactions table to track blockchain transaction confirmations
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE blockchain_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_hash TEXT NOT NULL UNIQUE,
    escrow_transaction_id UUID REFERENCES escrow_transactions(id) ON DELETE SET NULL,
    network VARCHAR(50) NOT NULL, -- 'polygon', 'ethereum', 'stellar', etc.
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'confirmed', 'failed'
    confirmations INTEGER DEFAULT 0,
    required_confirmations INTEGER DEFAULT 3,
    block_number BIGINT,
    gas_used NUMERIC(20, 0),
    gas_price NUMERIC(20, 0),
    from_address TEXT,
    to_address TEXT,
    value NUMERIC(20, 7),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_blockchain_status CHECK (status IN ('pending', 'confirmed', 'failed'))
);

-- Indexes for fast queries
CREATE INDEX idx_blockchain_transactions_hash ON blockchain_transactions(transaction_hash);
CREATE INDEX idx_blockchain_transactions_escrow_id ON blockchain_transactions(escrow_transaction_id);
CREATE INDEX idx_blockchain_transactions_status ON blockchain_transactions(status);
CREATE INDEX idx_blockchain_transactions_network ON blockchain_transactions(network);
CREATE INDEX idx_blockchain_transactions_created_at ON blockchain_transactions(created_at DESC);

-- Add updated_at trigger
CREATE TRIGGER update_blockchain_transactions_updated_at
    BEFORE UPDATE ON blockchain_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE blockchain_transactions IS 'Tracks blockchain transaction confirmations for escrow operations';
COMMENT ON COLUMN blockchain_transactions.confirmations IS 'Number of block confirmations received';
COMMENT ON COLUMN blockchain_transactions.required_confirmations IS 'Number of confirmations required before considering transaction confirmed';
