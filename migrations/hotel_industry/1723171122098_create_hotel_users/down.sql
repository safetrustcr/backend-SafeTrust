DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
DROP FUNCTION IF EXISTS update_users_updated_at();

DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_firebase_uid;
DROP INDEX IF EXISTS idx_users_email;

DROP TABLE IF EXISTS public.users CASCADE;
