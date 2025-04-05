
-- Drop indexes
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_wallet_address;
DROP INDEX IF EXISTS idx_users_created_at;

-- Drop the users table
DROP TABLE IF EXISTS users; 