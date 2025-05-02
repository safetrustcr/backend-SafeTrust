-- Create the escrow_transaction_users table
CREATE TABLE public.escrow_transaction_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id),
    escrow_transaction_id UUID NOT NULL,
    role VARCHAR(20),
    status VARCHAR(20),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_escrow_user_role UNIQUE (escrow_transaction_id, user_id, role)
);

-- Create an index for faster lookups
CREATE INDEX idx_escrow_transaction_users_transaction_id ON public.escrow_transaction_users(escrow_transaction_id);
CREATE INDEX idx_escrow_transaction_users_user_id ON public.escrow_transaction_users(user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_escrow_transaction_users_updated_at
    BEFORE UPDATE ON public.escrow_transaction_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 
