-- Migration: Add role column to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'guest';

-- Backfill any existing NULL values before enforcing NOT NULL
UPDATE public.users SET role = 'guest' WHERE role IS NULL;

-- Now enforce NOT NULL
ALTER TABLE public.users
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS valid_user_role;

ALTER TABLE public.users
  ADD CONSTRAINT valid_user_role
    CHECK (role IN ('guest', 'host', 'admin'));

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);