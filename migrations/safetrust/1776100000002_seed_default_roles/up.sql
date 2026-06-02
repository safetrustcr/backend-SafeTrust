INSERT INTO public.roles (name)
VALUES
  ('admin'),
  ('host'),
  ('guest')
ON CONFLICT (name) DO NOTHING;
