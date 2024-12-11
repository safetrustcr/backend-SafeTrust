-- Crear tipos ENUM para xdr_status si no existe
CREATE TYPE xdr_status AS ENUM (
    'PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'FAILED'
);

-- Crear tabla escrow_xdr_transactions
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
