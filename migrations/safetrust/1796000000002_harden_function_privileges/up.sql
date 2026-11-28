-- Database hardening — pin search_path on every function in the safetrust
-- schema and remove the default PUBLIC EXECUTE grant.
--
-- Why: a role that can create objects in a schema that appears earlier on a
-- function's search_path can shadow the tables or operators the function uses.
-- Pinning search_path to the application schema and revoking PUBLIC EXECUTE
-- closes that vector. None of these functions is SECURITY DEFINER today; if one
-- is ever added, this same search_path pinning is mandatory (a definer function
-- runs with the owner's privileges, so an attacker-controlled search_path is
-- far more dangerous). The CI check scripts/sql/verify-function-hardening.sql
-- fails the build if any function in this schema lacks a fixed search_path or
-- is still executable by PUBLIC.

-- New functions created in this schema start with EXECUTE revoked from PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

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
    EXECUTE format('ALTER FUNCTION %s SET search_path = safetrust, public', fn);
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO hasura, webhook, postgres', fn); -- security-reviewed: grant EXECUTE to the service roles after removing PUBLIC
  END LOOP;
END
$$;
