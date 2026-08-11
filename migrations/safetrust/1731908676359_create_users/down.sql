<<<<<<< HEAD
-- Remove role additions first before dropping the table
DROP INDEX IF EXISTS idx_users_role;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS valid_user_role;
ALTER TABLE public.users DROP COLUMN IF EXISTS role;

-- Then drop the table
=======
DROP INDEX IF EXISTS idx_users_firebase_uid;
DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE IF EXISTS public.users
    DROP CONSTRAINT IF EXISTS users_email_unique;
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5
DROP TABLE IF EXISTS public.users CASCADE;