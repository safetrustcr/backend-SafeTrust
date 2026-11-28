-- Revert the hotel_industry function hardening. The roles are kept (dropping
-- them would break existing connections).

ALTER ROLE hasura RESET statement_timeout; -- security-reviewed: revert role timeout
ALTER ROLE hasura RESET idle_in_transaction_session_timeout; -- security-reviewed: revert role timeout
ALTER ROLE webhook RESET statement_timeout; -- security-reviewed: revert role timeout
ALTER ROLE webhook RESET idle_in_transaction_session_timeout; -- security-reviewed: revert role timeout

ALTER DEFAULT PRIVILEGES IN SCHEMA hotel_industry GRANT EXECUTE ON FUNCTIONS TO PUBLIC; -- security-reviewed: revert the default-privilege change

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
    EXECUTE format('ALTER FUNCTION %s RESET search_path', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', fn); -- security-reviewed: revert PUBLIC EXECUTE removal
  END LOOP;
END
$$;
