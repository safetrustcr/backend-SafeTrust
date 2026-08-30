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

ALTER FUNCTION IF EXISTS safetrust.find_nearby_apartments(double precision, double precision, double precision) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.find_apartments_by_owner(uuid) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.search_apartments(text, text, numeric, numeric, text) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.get_apartments_in_bounds(double precision, double precision, double precision, double precision) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.get_escrow_analytics_by_day(date, date) SET SCHEMA public;
ALTER FUNCTION IF EXISTS safetrust.get_escrow_status_summary() SET SCHEMA public;

ALTER ROLE CURRENT_USER SET search_path TO public;
DROP SCHEMA IF EXISTS safetrust;
