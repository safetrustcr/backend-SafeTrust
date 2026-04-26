DROP INDEX IF EXISTS public.idx_users_firebase_uid;
ALTER TABLE public.users DROP COLUMN IF EXISTS firebase_uid;
