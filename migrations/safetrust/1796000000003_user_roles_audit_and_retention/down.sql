-- Revert the audit trail and retention function.

DROP TRIGGER IF EXISTS user_roles_audit ON safetrust.user_roles;
DROP FUNCTION IF EXISTS safetrust.audit_user_roles();
DROP FUNCTION IF EXISTS safetrust.prune_operational_data(INTEGER, INTEGER);
DROP TABLE IF EXISTS safetrust.user_roles_audit;
