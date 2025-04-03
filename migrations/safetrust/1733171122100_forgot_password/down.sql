-- Drop indexes first
DROP INDEX IF EXISTS idx_password_reset_tokens_token;
DROP INDEX IF EXISTS idx_password_reset_tokens_user_id;
DROP INDEX IF EXISTS idx_password_reset_tokens_expires_at;

-- Drop the password_reset_tokens table
DROP TABLE IF EXISTS password_reset_tokens;

-- Drop the password index
DROP INDEX IF EXISTS idx_users_password;