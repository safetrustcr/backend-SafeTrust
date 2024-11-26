CREATE TABLE users (
    id TEXT PRIMARY KEY,  -- Firebase UID
    email TEXT NOT NULL,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
