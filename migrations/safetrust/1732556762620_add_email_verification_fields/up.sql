-- Add verification-related columns to the users table
ALTER TABLE users
ADD COLUMN verification_code TEXT,
ADD COLUMN verification_code_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN is_email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN verification_attempts INTEGER DEFAULT 0,
ADD COLUMN last_verification_request TIMESTAMP WITH TIME ZONE;

-- Add constraints for usuers
ALTER TABLE users
ADD CONSTRAINT valid_verification_code
  CHECK (verification_code ~ '^[0-9]{6}$'),
ADD CONSTRAINT max_verification_attempts
  CHECK (verification_attempts <= 5);

-- Create index for faster email verification queries
CREATE INDEX idx_email_verification ON users (email, verification_code)
WHERE is_email_verified = FALSE;
