-- Drop trigger and function
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS users_email_idx;
DROP INDEX IF EXISTS users_created_at_idx;

-- Drop table
DROP TABLE IF EXISTS public.users; 