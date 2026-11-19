-- Restore the previous function bodies; the preceding migration restores tables.
SET LOCAL check_function_bodies = off;
DO $migration$
DECLARE
  tenant_function record;
BEGIN
  FOR tenant_function IN
    SELECT p.oid, p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'safetrust' AND p.proname IN ('find_nearby_apartments', 'find_apartments_by_owner', 'search_apartments', 'get_apartments_in_bounds', 'get_escrow_analytics_by_day', 'get_escrow_status_summary')
  LOOP
    EXECUTE replace(pg_get_functiondef(tenant_function.oid), 'FROM safetrust.', 'FROM public.');
  END LOOP;
END;
$migration$;
