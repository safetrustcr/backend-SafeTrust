-- Composite index: owner + soft-delete filter + created_at sort in one index scan
CREATE INDEX IF NOT EXISTS idx_apartments_owner_active_created
  ON public.apartments(owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Set-returning function for Hasura to expose as a typed GraphQL query
CREATE OR REPLACE FUNCTION public.find_apartments_by_owner(
  owner_id_input TEXT,
  limit_input INTEGER DEFAULT 10,
  offset_input INTEGER DEFAULT 0
)
RETURNS SETOF public.apartments
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.apartments
  WHERE
    owner_id = owner_id_input
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT limit_input
  OFFSET offset_input;
$$;
