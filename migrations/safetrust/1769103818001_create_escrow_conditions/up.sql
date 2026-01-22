-- Create escrow_conditions table to track condition verification
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE escrow_conditions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_transaction_id UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE CASCADE,
    condition_type VARCHAR(50) NOT NULL, -- 'delivery', 'inspection', 'approval', etc.
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'verified', 'rejected', 'expired'
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_condition_status CHECK (status IN ('pending', 'verified', 'rejected', 'expired'))
);

-- Indexes for fast queries
CREATE INDEX idx_escrow_conditions_escrow_id ON escrow_conditions(escrow_transaction_id);
CREATE INDEX idx_escrow_conditions_status ON escrow_conditions(status);
CREATE INDEX idx_escrow_conditions_type ON escrow_conditions(condition_type);
CREATE INDEX idx_escrow_conditions_verified_by ON escrow_conditions(verified_by);
CREATE INDEX idx_escrow_conditions_created_at ON escrow_conditions(created_at);

-- Add updated_at trigger
CREATE TRIGGER update_escrow_conditions_updated_at
    BEFORE UPDATE ON escrow_conditions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE escrow_conditions IS 'Tracks conditions that must be met before escrow funds can be released';
COMMENT ON COLUMN escrow_conditions.condition_type IS 'Type of condition: delivery, inspection, approval, etc.';
COMMENT ON COLUMN escrow_conditions.status IS 'Verification status: pending, verified, rejected, or expired';
