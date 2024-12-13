CREATE TABLE escrow_api_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_transaction_id UUID REFERENCES escrow_transactions(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    request_body JSONB,
    http_status_code INTEGER,
    response_body JSONB,
    error_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_http_status CHECK (
        http_status_code >= 100 AND 
        http_status_code < 600
    ),
    CONSTRAINT valid_http_method CHECK (
        method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')
    )
);

CREATE INDEX idx_escrow_api_calls_transaction ON escrow_api_calls(escrow_transaction_id);
CREATE INDEX idx_escrow_api_calls_status ON escrow_api_calls(http_status_code);