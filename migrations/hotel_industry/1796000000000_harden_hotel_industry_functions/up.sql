-- Database hardening for the hotel_industry tenant, mirroring the safetrust
-- migration so a hotel-only deployment is self-contained:
--   1. create the least-privilege service roles (idempotent) and pin
--      server-side timeouts;
--   2. pin search_path on every hotel_industry function and remove the default
--      PUBLIC EXECUTE grant.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hasura') THEN
    CREATE ROLE hasura LOGIN; -- security-reviewed: dedicated least-privilege role for Hasura
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webhook') THEN
    CREATE ROLE webhook LOGIN; -- security-reviewed: dedicated least-privilege role for the webhook
  END IF;
END
$$;

ALTER ROLE hasura SET statement_timeout = '30s'; -- security-reviewed: bound server-side query time
ALTER ROLE webhook SET statement_timeout = '30s'; -- security-reviewed: bound server-side query time
ALTER ROLE hasura SET idle_in_transaction_session_timeout = '60s'; -- security-reviewed: abort idle-in-transaction sessions
ALTER ROLE webhook SET idle_in_transaction_session_timeout = '60s'; -- security-reviewed: abort idle-in-transaction sessions

-- New functions created in this schema start with EXECUTE revoked from PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA hotel_industry REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'hotel_industry'
      AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = hotel_industry, public', fn);
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO hasura, webhook, postgres', fn); -- security-reviewed: grant EXECUTE to the service roles after removing PUBLIC
  END LOOP;
END
$$;
