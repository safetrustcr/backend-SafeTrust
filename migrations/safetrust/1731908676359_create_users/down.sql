-- Remove UNIQUE constraint
ALTER TABLE IF EXISTS users
    DROP CONSTRAINT IF EXISTS users_email_unique CASCADE;

DROP TABLE IF EXISTS users CASCADE;

-- Remove indices
DROP INDEX IF EXISTS idx_users_email CASCADE;