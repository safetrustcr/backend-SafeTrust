-- Drop audit_logs table (redundant with trustless_work_webhook_events)
-- Security/audit trail handled by trustless_work_webhook_events and escrow_pending_approvals (see issue #schema-cleanup)

DROP TABLE IF EXISTS public.audit_logs CASCADE;
