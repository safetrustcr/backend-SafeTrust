-- verify-function-hardening.sql
--
-- CI gate that independently asserts the FINAL state of the test database:
-- every function/procedure in the tenant schemas `safetrust` and
-- `hotel_industry` must have a fixed `search_path` pinned on it, and PUBLIC
-- must not be able to EXECUTE it.
--
-- Run with:
--   psql -v ON_ERROR_STOP=1 -f /verify-function-hardening.sql
--
-- Any violation raises an EXCEPTION, which makes psql exit non-zero and fails
-- the CI step. Read-only: this script only inspects the system catalogs.

DO $$
DECLARE
  missing_search_path text;
  public_executable text;
BEGIN
  -- 3. The `extensions` schema is expected to exist (created by the hardening
  --    task). Report it if it is missing so the failure is obvious.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RAISE EXCEPTION 'extensions schema violation: schema "extensions" does not exist';
  END IF;

  -- 1. Any function/procedure in the two tenant schemas whose effective
  --    configuration does not pin a search_path setting.
  SELECT string_agg(format('%I.%I', n.nspname, p.proname), ', ' ORDER BY n.nspname, p.proname)
  INTO missing_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('safetrust', 'hotel_industry')
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS c
      WHERE c LIKE 'search_path=%'
    );

  IF missing_search_path IS NOT NULL THEN
    RAISE EXCEPTION 'function search_path violation: %', missing_search_path;
  END IF;

  -- 2. Any function/procedure in the two tenant schemas that PUBLIC can still
  --    EXECUTE. A NULL proacl means the default ACL applies, which grants
  --    EXECUTE to PUBLIC (grantee = 0).
  SELECT string_agg(format('%I.%I', n.nspname, p.proname), ', ' ORDER BY n.nspname, p.proname)
  INTO public_executable
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('safetrust', 'hotel_industry')
    AND p.prokind IN ('f', 'p')
    AND EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    );

  IF public_executable IS NOT NULL THEN
    RAISE EXCEPTION 'function PUBLIC execute violation: %', public_executable;
  END IF;
END;
$$;
