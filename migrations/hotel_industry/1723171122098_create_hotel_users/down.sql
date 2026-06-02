-- Drop table first (CASCADE removes triggers and indexes; avoids DROP TRIGGER on missing table)
DROP TABLE IF EXISTS public.users CASCADE;

DROP FUNCTION IF EXISTS update_users_updated_at();
