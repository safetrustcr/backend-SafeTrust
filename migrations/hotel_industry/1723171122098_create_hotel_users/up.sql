-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table for hotel_industry tenant
-- Note: hotel_id is intentionally excluded here.
-- It is added via a later ALTER TABLE migration after hotels table exists.
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid TEXT,
    email VARCHAR(150) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    phone_number VARCHAR(15),
    role VARCHAR(20) NOT NULL DEFAULT 'GUEST',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT valid_user_role CHECK (role IN ('GUEST', 'STAFF', 'MANAGER'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON public.users(firebase_uid)
    WHERE firebase_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();