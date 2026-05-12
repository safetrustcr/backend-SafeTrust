-- Remove UNIQUE constraint
ALTER TABLE IF EXISTS public.users
    DROP CONSTRAINT IF EXISTS users_email_unique CASCADE;

-- Remove indices
DROP INDEX IF EXISTS idx_users_email CASCADE;
DROP INDEX IF EXISTS idx_users_firebase_uid CASCADE;

DROP TABLE IF EXISTS public.users CASCADE;