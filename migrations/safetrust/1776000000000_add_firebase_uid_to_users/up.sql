ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE;

-- Copy existing IDs to firebase_uid if any (optional but good for consistency)
-- UPDATE public.users SET firebase_uid = id WHERE firebase_uid IS NULL;

-- Index for lookup performance
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON public.users(firebase_uid);
