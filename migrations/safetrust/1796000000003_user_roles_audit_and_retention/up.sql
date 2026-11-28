-- Database hardening — audit trail for role changes and a scheduled retention
-- function for operational data.
--
-- 1. safetrust.user_roles_audit records every INSERT/DELETE of user_roles so a
--    privilege change (someone becoming admin or host) is attributable. The
--    actor comes from the session setting `hasura.user`, which Hasura sets for
--    requests it proxies and the webhook sets for its own writes; it is NULL
--    when unknown.
-- 2. safetrust.prune_operational_data() implements the retention rule: delete
--    finished escrow_confirmation_retries rows and strip the payload from old
--    trustless_work_webhook_events rows while keeping event_identity (needed
--    for idempotency) and the columns analytics reads. It is called on a
--    schedule by the retention cron trigger -> webhook route.

CREATE TABLE IF NOT EXISTS safetrust.user_roles_audit (
  id         BIGSERIAL   PRIMARY KEY,
  user_id    TEXT        NOT NULL,
  role_id    INTEGER     NOT NULL,
  action     TEXT        NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT user_roles_audit_action_check CHECK (action IN ('insert', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_user_roles_audit_user_id
  ON safetrust.user_roles_audit (user_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_audit_changed_at
  ON safetrust.user_roles_audit (changed_at);

COMMENT ON TABLE safetrust.user_roles_audit
  IS 'Audit trail of user_roles changes — who granted or revoked which role, and when';

CREATE OR REPLACE FUNCTION safetrust.audit_user_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = safetrust, public
AS $$
DECLARE
  actor TEXT;
BEGIN
  -- Best-effort: an unset or empty session setting means the actor is unknown.
  BEGIN
    actor := NULLIF(current_setting('hasura.user', true), '');
  EXCEPTION WHEN others THEN
    actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO safetrust.user_roles_audit (user_id, role_id, action, changed_by)
    VALUES (NEW.user_id, NEW.role_id, 'insert', actor);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO safetrust.user_roles_audit (user_id, role_id, action, changed_by)
    VALUES (OLD.user_id, OLD.role_id, 'delete', actor);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_audit ON safetrust.user_roles;
CREATE TRIGGER user_roles_audit
  AFTER INSERT OR DELETE ON safetrust.user_roles
  FOR EACH ROW EXECUTE FUNCTION safetrust.audit_user_roles();

CREATE OR REPLACE FUNCTION safetrust.prune_operational_data(
  retry_days INTEGER DEFAULT 30,
  payload_days INTEGER DEFAULT 90
)
RETURNS TABLE (deleted_retries BIGINT, scrubbed_payloads BIGINT)
LANGUAGE plpgsql
SET search_path = safetrust, public
AS $$
DECLARE
  deleted  BIGINT;
  scrubbed BIGINT;
BEGIN
  IF retry_days IS NULL OR retry_days < 1 THEN
    RAISE EXCEPTION 'retry_days must be a positive integer (got %)', retry_days;
  END IF;
  IF payload_days IS NULL OR payload_days < 1 THEN
    RAISE EXCEPTION 'payload_days must be a positive integer (got %)', payload_days;
  END IF;

  DELETE FROM safetrust.escrow_confirmation_retries
  WHERE status IN ('completed', 'dead_letter')
    AND created_at < NOW() - make_interval(days => retry_days);
  GET DIAGNOSTICS deleted = ROW_COUNT;

  UPDATE safetrust.trustless_work_webhook_events
  SET payload = NULL
  WHERE payload IS NOT NULL
    AND created_at < NOW() - make_interval(days => payload_days);
  GET DIAGNOSTICS scrubbed = ROW_COUNT;

  RETURN QUERY SELECT deleted, scrubbed;
END;
$$;

COMMENT ON FUNCTION safetrust.prune_operational_data(INTEGER, INTEGER)
  IS 'Retention: drop finished escrow_confirmation_retries rows and null out old webhook payloads (keeps event_identity)';

-- The functions created above are covered by these REVOKEs explicitly, in case
-- the ALTER DEFAULT PRIVILEGES from an earlier migration did not apply.
REVOKE ALL PRIVILEGES ON FUNCTION safetrust.audit_user_roles() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION safetrust.prune_operational_data(INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION safetrust.prune_operational_data(INTEGER, INTEGER) TO hasura, webhook; -- security-reviewed: allow the service roles to run the retention job
GRANT EXECUTE ON FUNCTION safetrust.audit_user_roles() TO postgres; -- security-reviewed: run the audit trigger as the table owner
