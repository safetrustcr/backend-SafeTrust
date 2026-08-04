CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.escrow_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reservation_id UUID REFERENCES hotel_industry.reservations(id),
    contract_id TEXT UNIQUE,
    escrow_status VARCHAR(200) DEFAULT 'PENDING',
    signer_address VARCHAR(200),
    transaction_type VARCHAR(150),
    escrow_transaction_type VARCHAR(150),
    http_status_code INTEGER,
    escrow_payload JSONB,
    fund_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_escrow_reservation
    ON hotel_industry.escrow_transactions(reservation_id);
CREATE INDEX IF NOT EXISTS idx_hotel_escrow_status
    ON hotel_industry.escrow_transactions(escrow_status);
CREATE INDEX IF NOT EXISTS idx_hotel_escrow_type
    ON hotel_industry.escrow_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_hotel_escrow_created_at
    ON hotel_industry.escrow_transactions(created_at);