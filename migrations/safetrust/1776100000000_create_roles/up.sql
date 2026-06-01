CREATE TABLE public.roles (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

COMMENT ON TABLE public.roles
  IS 'Application roles: admin, host, guest';

CREATE INDEX idx_roles_name
  ON public.roles(name);
