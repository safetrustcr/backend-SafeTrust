CREATE TYPE escrow_transaction_type AS ENUM (
    'CREATE_ESCROW',
    'FUND_ESCROW',
    'COMPLETE_ESCROW',
    'CANCEL_ESCROW',
    'REFUND_ESCROW'
);

CREATE TYPE escrow_status AS ENUM (
    'PENDING',
    'AWAITING_SIGNATURE',
    'SIGNED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'REFUNDED'
);

CREATE TABLE escrow_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_request_id UUID REFERENCES bid_requests(id) ON DELETE CASCADE,
    engagement_id TEXT,
    contract_id TEXT,
    signer_address TEXT,
    transaction_type escrow_transaction_type NOT NULL,
    status escrow_status NOT NULL DEFAULT 'PENDING',
    http_status_code INTEGER,
    http_response_body JSONB,
    http_error_details JSONB,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    initial_deposit_percentage INTEGER DEFAULT 50,
    cancellation_reason TEXT,
    cancelled_by TEXT REFERENCES users(id),
    refund_status escrow_status,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_http_status CHECK (
        http_status_code >= 100 AND 
        http_status_code < 600
    ),
    CONSTRAINT valid_contract_id_when_needed CHECK (
        (transaction_type IN ('FUND_ESCROW', 'COMPLETE_ESCROW', 'CANCEL_ESCROW')) = 
        (contract_id IS NOT NULL)
    )
);

CREATE INDEX idx_escrow_transactions_bid ON escrow_transactions(bid_request_id);
CREATE INDEX idx_escrow_transactions_contract ON escrow_transactions(contract_id);
CREATE INDEX idx_escrow_transactions_status ON escrow_transactions(status);
CREATE INDEX idx_escrow_transactions_type_status ON escrow_transactions(transaction_type, status);