CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid TEXT,
    email VARCHAR(150) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    phone_number VARCHAR(15),
    role VARCHAR(20) NOT NULL DEFAULT 'GUEST',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT hotel_users_email_unique UNIQUE (email),
    CONSTRAINT hotel_valid_user_role CHECK (role IN ('GUEST', 'STAFF', 'MANAGER'))
);

CREATE INDEX IF NOT EXISTS idx_hotel_users_email
    ON hotel_industry.users(email);
CREATE INDEX IF NOT EXISTS idx_hotel_users_firebase_uid
    ON hotel_industry.users(firebase_uid)
    WHERE firebase_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hotel_users_role
    ON hotel_industry.users(role);

CREATE OR REPLACE FUNCTION hotel_industry.update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_hotel_users_updated_at
    BEFORE UPDATE ON hotel_industry.users
    FOR EACH ROW
    EXECUTE FUNCTION hotel_industry.update_users_updated_at();