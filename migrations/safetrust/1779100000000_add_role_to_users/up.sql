-- Migration: Add role column to public.users
-- Separated from create_users to avoid schema drift between
-- existing and fresh tenant deployments.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'guest';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS valid_user_role;

ALTER TABLE public.users
  ADD CONSTRAINT valid_user_role
    CHECK (role IN ('guest', 'host', 'admin'));

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);