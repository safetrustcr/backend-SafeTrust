CREATE TABLE public.users (
    id TEXT PRIMARY KEY,           -- Firebase UID
    firebase_uid TEXT,             -- explicit Firebase UID reference
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint on email
ALTER TABLE public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Indices for common queries
CREATE INDEX idx_users_email ON public.users(email);
CREATE INDEX idx_users_firebase_uid ON public.users(firebase_uid);