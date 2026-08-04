-- migrations/safetrust/1779000000000_add_role_to_users/up.sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'GUEST';

ALTER TABLE public.users
  ADD CONSTRAINT valid_user_role CHECK (role IN ('GUEST', 'STAFF', 'MANAGER', 'host', 'guest', 'admin'));

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);