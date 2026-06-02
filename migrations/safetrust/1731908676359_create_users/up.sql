-- public.users — safetrust tenant
-- Canonical source: dApp-SafeTrust/infra/hasura/migrations/safetrust/1731908676359_create_users/up.sql

CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,           -- Firebase UID (doubles as PK)
    firebase_uid TEXT NOT NULL,    -- explicit Firebase UID reference (NOT NULL — auth invariant)
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,             -- required for user profile flow
    country_code TEXT,             -- required for user profile flow
    location TEXT,                 -- required for user profile flow
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint on email
ALTER TABLE public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email
    ON public.users(email);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_email_unique'
          AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_email_unique UNIQUE (email);
    END IF;
END $$;

-- UNIQUE index — one Firebase UID per user account
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON public.users(firebase_uid);
