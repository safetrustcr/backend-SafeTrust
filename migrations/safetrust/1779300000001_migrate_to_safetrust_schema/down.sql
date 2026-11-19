-- Reverse: move all tables back to public
ALTER TABLE safetrust.users                         SET SCHEMA public;
ALTER TABLE safetrust.user_wallets                  SET SCHEMA public;
ALTER TABLE safetrust.roles                         SET SCHEMA public;
ALTER TABLE safetrust.user_roles                    SET SCHEMA public;
ALTER TABLE safetrust.trustless_work_escrows        SET SCHEMA public;
ALTER TABLE safetrust.trustless_work_webhook_events SET SCHEMA public;
ALTER TABLE safetrust.escrow_milestones             SET SCHEMA public;
ALTER TABLE safetrust.escrow_transactions           SET SCHEMA public;
ALTER TABLE safetrust.apartments                    SET SCHEMA public;
ALTER TABLE safetrust.apartment_images              SET SCHEMA public;
ALTER TABLE safetrust.reservations                  SET SCHEMA public;
ALTER TABLE safetrust.bid_requests                  SET SCHEMA public;
ALTER TABLE safetrust.pricing_rules                 SET SCHEMA public;
ALTER TABLE safetrust.pricing_overrides             SET SCHEMA public;
ALTER TABLE safetrust.conversations                 SET SCHEMA public;
ALTER TABLE safetrust.messages                      SET SCHEMA public;

ALTER TABLE IF EXISTS safetrust.bid_status_histories         SET SCHEMA public;
ALTER TABLE IF EXISTS safetrust.escrow_pending_approvals     SET SCHEMA public;
ALTER TABLE IF EXISTS safetrust.escrow_analytics_by_day     SET SCHEMA public;
ALTER TABLE IF EXISTS safetrust.escrow_status_summary        SET SCHEMA public;

-- ALTER FUNCTION has no IF EXISTS clause; resolve each exact signature first.
DO $migration$
DECLARE
  function_signature text;
  existing_function regprocedure;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'safetrust.find_nearby_apartments(double precision, double precision, double precision)',
    'safetrust.find_apartments_by_owner(text, integer, integer)',
    'safetrust.search_apartments(text, text, numeric, numeric, integer, integer, boolean, boolean, integer, integer)',
    'safetrust.get_apartments_in_bounds(double precision, double precision, double precision, double precision)',
    'safetrust.get_escrow_analytics_by_day(timestamp with time zone, timestamp with time zone, character varying)',
    'safetrust.get_escrow_status_summary(character varying)'
  ]
  LOOP
    existing_function := to_regprocedure(function_signature);
    IF existing_function IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET SCHEMA %I', existing_function, 'public');
    END IF;
  END LOOP;
END;
$migration$;

ALTER ROLE CURRENT_USER SET search_path TO public;
DROP SCHEMA IF EXISTS safetrust;
