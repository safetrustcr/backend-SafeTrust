-- Create transaction type enum
CREATE TYPE escrow_transaction_type AS ENUM (
    'CREATE_ESCROW',
    'FUND_ESCROW',
    'COMPLETE_ESCROW',
    'CANCEL_ESCROW',
    'REFUND_ESCROW'
);

-- Create escrow status enum
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

-- Create XDR status enum
CREATE TYPE xdr_status AS ENUM (
    'PENDING',
    'GENERATED',
    'SIGNED',
    'SUBMITTED',
    'CONFIRMED',
    'FAILED'
);

-- Create main escrow_transactions table
CREATE TABLE escrow_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_request_id UUID REFERENCES bid_requests(id) ON DELETE CASCADE,
    
    -- Trustless API fields
    engagement_id TEXT,
    contract_id TEXT,
    signer_address TEXT,
    
    -- Transaction details
    transaction_type escrow_transaction_type NOT NULL,
    status escrow_status NOT NULL DEFAULT 'PENDING',
    
    -- HTTP response tracking
    http_status_code INTEGER,
    http_response_body JSONB,
    http_error_details JSONB,
    
    -- Amount and deposit tracking
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    initial_deposit_percentage INTEGER DEFAULT 50,
    
    -- Cancellation details
    cancellation_reason TEXT,
    cancelled_by TEXT REFERENCES users(id),
    refund_status escrow_status,
    
    -- Metadata and timestamps
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT valid_http_status CHECK (
        http_status_code >= 100 AND 
        http_status_code < 600
    ),
    CONSTRAINT valid_contract_id_when_needed CHECK (
        (transaction_type IN ('FUND_ESCROW', 'COMPLETE_ESCROW', 'CANCEL_ESCROW')) = 
        (contract_id IS NOT NULL)
    )
);

-- Create XDR transactions tracking table
CREATE TABLE escrow_xdr_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_transaction_id UUID REFERENCES escrow_transactions(id) ON DELETE CASCADE,
    xdr_type escrow_transaction_type NOT NULL,
    unsigned_xdr TEXT NOT NULL,
    signed_xdr TEXT,
    status xdr_status DEFAULT 'PENDING',
    signing_address TEXT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_xdr_fields CHECK (
        (status = 'SIGNED' AND signed_xdr IS NOT NULL) OR
        (status != 'SIGNED')
    )
);

-- Create API calls tracking table
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

-- Create required indexes
CREATE INDEX idx_escrow_transactions_bid ON escrow_transactions(bid_request_id);
CREATE INDEX idx_escrow_transactions_contract ON escrow_transactions(contract_id);
CREATE INDEX idx_escrow_transactions_status ON escrow_transactions(status);
CREATE INDEX idx_escrow_transactions_type_status ON escrow_transactions(transaction_type, status);
CREATE INDEX idx_escrow_xdr_transaction ON escrow_xdr_transactions(escrow_transaction_id);
CREATE INDEX idx_escrow_api_calls_transaction ON escrow_api_calls(escrow_transaction_id);
CREATE INDEX idx_escrow_api_calls_status ON escrow_api_calls(http_status_code);
