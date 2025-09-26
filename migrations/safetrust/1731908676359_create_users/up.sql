CREATE TABLE users (
    id TEXT PRIMARY KEY,  -- Firebase UID
    email TEXT NOT NULL,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add UNIQUE constraint to email
ALTER TABLE users 
    ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Add indices for common queries
CREATE INDEX idx_users_email ON users(email);