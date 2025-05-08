-- Create the escrow_transaction_users table
CREATE TABLE escrow_transaction_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    escrow_transaction_id UUID REFERENCES escrow_transactions(id),
    role VARCHAR(20),
    status VARCHAR(20),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_escrow_user_role UNIQUE (escrow_transaction_id, user_id, role)
);

-- Create an index for faster lookups
CREATE INDEX idx_escrow_transaction_users_transaction_id ON public.escrow_transaction_users(escrow_transaction_id);
CREATE INDEX idx_escrow_transaction_users_user_id ON public.escrow_transaction_users(user_id); 
