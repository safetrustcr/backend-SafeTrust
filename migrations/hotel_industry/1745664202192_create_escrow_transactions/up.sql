CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE escrow_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Foreign key relationships will be added later when related tables are ready
    reservation_id UUID,
    contract_id TEXT UNIQUE, 
    escrow_status VARCHAR(200) DEFAULT 'PENDING',
    signer_address VARCHAR(200),
    transaction_type VARCHAR(150),
    escrow_transaction_type VARCHAR(150),
    http_status_code INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_escrow_transactions_reservation ON escrow_transactions(reservation_id);
CREATE INDEX idx_escrow_transactions_status ON escrow_transactions(escrow_status);
CREATE INDEX idx_escrow_transactions_type ON escrow_transactions(transaction_type);
CREATE INDEX idx_escrow_transactions_created_at ON escrow_transactions(created_at);


-- TODO: Add foreign keys later when the related tables are created:

-- ALTER TABLE escrow_transactions
--   ADD CONSTRAINT fk_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id);
--

ALTER TABLE escrow_transactions
ADD COLUMN escrow_payload JSONB;