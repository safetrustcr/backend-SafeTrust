-- Step 1: Create the safetrust schema
CREATE SCHEMA IF NOT EXISTS safetrust;

-- Step 2: Move all tables (preserves data, indexes, sequences)
-- PostgreSQL ALTER TABLE ... SET SCHEMA is atomic and non-destructive
ALTER TABLE public.users                         SET SCHEMA safetrust;
ALTER TABLE public.user_wallets                  SET SCHEMA safetrust;
ALTER TABLE public.roles                         SET SCHEMA safetrust;
ALTER TABLE public.user_roles                    SET SCHEMA safetrust;
ALTER TABLE public.trustless_work_escrows        SET SCHEMA safetrust;
ALTER TABLE public.trustless_work_webhook_events SET SCHEMA safetrust;
ALTER TABLE public.escrow_milestones             SET SCHEMA safetrust;
ALTER TABLE public.escrow_transactions           SET SCHEMA safetrust;
ALTER TABLE public.apartments                    SET SCHEMA safetrust;
ALTER TABLE public.apartment_images              SET SCHEMA safetrust;
ALTER TABLE public.reservations                  SET SCHEMA safetrust;
ALTER TABLE public.bid_requests                  SET SCHEMA safetrust;
ALTER TABLE public.pricing_rules                 SET SCHEMA safetrust;
ALTER TABLE public.pricing_overrides             SET SCHEMA safetrust;
ALTER TABLE public.conversations                 SET SCHEMA safetrust;
ALTER TABLE public.messages                      SET SCHEMA safetrust;

ALTER TABLE IF EXISTS public.bid_status_histories         SET SCHEMA safetrust;
ALTER TABLE IF EXISTS public.escrow_pending_approvals     SET SCHEMA safetrust;
ALTER TABLE IF EXISTS public.escrow_analytics_by_day     SET SCHEMA safetrust;
ALTER TABLE IF EXISTS public.escrow_status_summary        SET SCHEMA safetrust;

-- Move functions to safetrust schema if present
-- ALTER FUNCTION has no IF EXISTS clause; resolve each exact signature first.
DO $migration$
DECLARE
  function_signature text;
  existing_function regprocedure;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.find_nearby_apartments(double precision, double precision, double precision)',
    'public.find_apartments_by_owner(text, integer, integer)',
    'public.search_apartments(text, text, numeric, numeric, integer, integer, boolean, boolean, integer, integer)',
    'public.get_apartments_in_bounds(double precision, double precision, double precision, double precision)',
    'public.get_escrow_analytics_by_day(timestamp with time zone, timestamp with time zone, character varying)',
    'public.get_escrow_status_summary(character varying)'
  ]
  LOOP
    existing_function := to_regprocedure(function_signature);
    IF existing_function IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET SCHEMA %I', existing_function, 'safetrust');
    END IF;
  END LOOP;
END;
$migration$;

-- Step 3: Add safetrust to search_path so existing queries still work
-- during transition period (remove after all queries are updated)
ALTER ROLE CURRENT_USER SET search_path TO safetrust, public;

-- Step 4: Grant schema permissions to hasura role
GRANT USAGE ON SCHEMA safetrust TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA safetrust TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA safetrust TO postgres;

-- Step 5: Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust
  GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust
  GRANT ALL ON SEQUENCES TO postgres;
