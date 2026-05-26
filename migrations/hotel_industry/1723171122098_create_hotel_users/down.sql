-- Drop trigger and function
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
DROP FUNCTION IF EXISTS update_users_updated_at();

-- Drop indexes
DROP INDEX IF EXISTS idx_users_firebase_uid;
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_hotel_id;
DROP INDEX IF EXISTS idx_users_email;

ALTER TABLE IF EXISTS public.users DROP CONSTRAINT IF EXISTS valid_user_role;
ALTER TABLE IF EXISTS public.users DROP CONSTRAINT IF EXISTS users_email_unique;

-- Drop table
DROP TABLE IF EXISTS public.users CASCADE;
