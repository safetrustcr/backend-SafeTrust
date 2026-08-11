-- Remove role additions first before dropping the table
DROP INDEX IF EXISTS idx_users_role;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS valid_user_role;
ALTER TABLE public.users DROP COLUMN IF EXISTS role;

-- Then drop the table
DROP TABLE IF EXISTS public.users CASCADE;