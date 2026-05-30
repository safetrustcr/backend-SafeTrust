-- public.users — safetrust tenant
-- Canonical source: dApp-SafeTrust/infra/hasura/migrations/safetrust/1731908676359_create_users/up.sql

CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,           -- Firebase UID as primary key
    firebase_uid TEXT NOT NULL,    -- explicit Firebase UID reference (NOT NULL)
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,             -- user profile field
    country_code TEXT,             -- user profile field
    location TEXT,                 -- user profile field
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Constraints
ALTER TABLE public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email
    ON public.users(email);

-- UNIQUE index — one Firebase UID per user account
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON public.users(firebase_uid);