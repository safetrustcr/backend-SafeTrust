-- Repair installations that already applied the schema move with stale signatures.
DO $migration$
DECLARE
  tenant_function record;
BEGIN
  FOR tenant_function IN
    SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'safetrust')
      AND p.proname IN ('find_nearby_apartments', 'find_apartments_by_owner', 'search_apartments', 'get_apartments_in_bounds', 'get_escrow_analytics_by_day', 'get_escrow_status_summary')
  LOOP
    IF tenant_function.nspname = 'public' THEN
      EXECUTE format('ALTER FUNCTION %s SET SCHEMA safetrust', tenant_function.oid::regprocedure);
    END IF;
    -- SET SCHEMA does not rewrite schema references inside SQL function bodies.
    EXECUTE replace(pg_get_functiondef(tenant_function.oid), 'public.', 'safetrust.');
  END LOOP;
END;
$migration$;
