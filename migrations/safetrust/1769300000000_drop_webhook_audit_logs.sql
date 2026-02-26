-- Drop webhook_audit_logs table and its cleanup function
-- Replaced by trustless_work_webhook_events for webhook event tracking (see issue #schema-cleanup)

DROP FUNCTION IF EXISTS cleanup_old_audit_logs();
DROP TABLE IF EXISTS public.webhook_audit_logs CASCADE;
