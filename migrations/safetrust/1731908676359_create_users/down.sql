-- Remove indices
DROP INDEX IF EXISTS idx_users_email;

-- Remove UNIQUE constraint
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_email_unique;

DROP TABLE IF EXISTS users;