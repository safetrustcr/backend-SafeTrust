-- Remove verification-related columns
ALTER TABLE users
DROP COLUMN verification_code,
DROP COLUMN verification_code_expires_at,
DROP COLUMN is_email_verified,
DROP COLUMN verification_attempts,
DROP COLUMN last_verification_request;
--Remove index
DROP INDEX IF EXISTS idx_email_verification;
