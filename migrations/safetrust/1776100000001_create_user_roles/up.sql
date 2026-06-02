CREATE TABLE public.user_roles (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    TEXT        NOT NULL
             REFERENCES public.users(id) ON DELETE CASCADE,
  role_id    INTEGER     NOT NULL
             REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE (user_id, role_id)
);

CREATE INDEX idx_user_roles_user_id
  ON public.user_roles(user_id);

CREATE INDEX idx_user_roles_role_id
  ON public.user_roles(role_id);

COMMENT ON TABLE public.user_roles
  IS 'Join table — one user can have multiple roles';

COMMENT ON COLUMN public.user_roles.user_id
  IS 'References public.users(id) — Firebase UID';

COMMENT ON COLUMN public.user_roles.role_id
  IS 'References public.roles(id)';
