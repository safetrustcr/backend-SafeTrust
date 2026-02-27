-- Drop indexes (in reverse order of creation)
DROP INDEX IF EXISTS public.idx_audit_logs_user_created;
DROP INDEX IF EXISTS public.idx_audit_logs_tenant_created;
DROP INDEX IF EXISTS public.idx_audit_logs_tenant;
DROP INDEX IF EXISTS public.idx_audit_logs_status;
DROP INDEX IF EXISTS public.idx_audit_logs_ip_address;
DROP INDEX IF EXISTS public.idx_audit_logs_user_id;
DROP INDEX IF EXISTS public.idx_audit_logs_endpoint;
DROP INDEX IF EXISTS public.idx_audit_logs_request_id;
DROP INDEX IF EXISTS public.idx_audit_logs_created_at;

-- Drop the table (CASCADE will handle constraints and any dependencies)
DROP TABLE IF EXISTS public.audit_logs CASCADE;
