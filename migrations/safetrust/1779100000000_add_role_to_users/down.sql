DROP INDEX IF EXISTS idx_users_role;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS valid_user_role;
ALTER TABLE public.users DROP COLUMN IF EXISTS role;