-- Best-effort reversal: reset the per-function search_path and restore the
-- default PUBLIC EXECUTE grant.

ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust GRANT EXECUTE ON FUNCTIONS TO PUBLIC; -- security-reviewed: revert the default-privilege change

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'safetrust'
      AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('ALTER FUNCTION %s RESET search_path', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', fn); -- security-reviewed: revert PUBLIC EXECUTE removal
  END LOOP;
END
$$;
