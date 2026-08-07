DROP INDEX IF EXISTS idx_users_firebase_uid;
DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE IF EXISTS public.users
    DROP CONSTRAINT IF EXISTS users_email_unique;
DROP TABLE IF EXISTS public.users CASCADE;

DROP INDEX IF EXISTS idx_users_role;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS valid_user_role;
ALTER TABLE public.users DROP COLUMN IF EXISTS role;