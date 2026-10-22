CREATE OR REPLACE VIEW safetrust.webhook_health_summary AS
SELECT
  NULL::BIGINT AS pending_count,
  NULL::BIGINT AS failed_count,
  NULL::NUMERIC AS oldest_unprocessed_age_minutes,
  NULL::TIMESTAMPTZ AS last_sync_at,
  NULL::BIGINT AS sync_lag_seconds
WHERE FALSE;

COMMENT ON VIEW safetrust.webhook_health_summary
  IS 'Hasura return type for get_webhook_health_summary(); the view itself contains no rows';

CREATE OR REPLACE FUNCTION safetrust.get_webhook_health_summary(hasura_session JSONB DEFAULT '{}'::JSONB)
RETURNS SETOF safetrust.webhook_health_summary
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  session_claims JSONB := COALESCE(
    hasura_session,
    NULLIF(current_setting('hasura.user', TRUE), '')::JSONB,
    '{}'::JSONB
  );
  session_role TEXT := session_claims ->> 'x-hasura-role';
  session_tenant_id TEXT := NULLIF(session_claims ->> 'x-hasura-tenant-id', '');
BEGIN
  IF session_role IS DISTINCT FROM 'admin' AND session_tenant_id IS NULL THEN
    RAISE EXCEPTION 'A verified x-hasura-tenant-id session claim is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH event_summary AS (
    SELECT
      COUNT(*) FILTER (WHERE processed IS NOT TRUE) AS pending_count,
      COUNT(*) FILTER (WHERE error_message IS NOT NULL) AS failed_count,
      MIN(created_at) FILTER (WHERE processed IS NOT TRUE) AS oldest_unprocessed_at
    FROM safetrust.trustless_work_webhook_events
    WHERE session_role = 'admin' OR tenant_id = session_tenant_id
  ),
  source_updates AS (
    SELECT updated_at
    FROM safetrust.trustless_work_escrows
    WHERE session_role = 'admin' OR tenant_id = session_tenant_id
    UNION ALL
    SELECT updated_at
    FROM safetrust.escrow_transactions
    WHERE session_role = 'admin' OR tenant_id = session_tenant_id
  ),
  latest_source_update AS (
    SELECT MAX(updated_at) AS last_sync_at
    FROM source_updates
  )
  SELECT
    event_summary.pending_count,
    event_summary.failed_count,
    ROUND(
      (EXTRACT(EPOCH FROM (statement_timestamp() - event_summary.oldest_unprocessed_at)) / 60)::NUMERIC,
      2
    ) AS oldest_unprocessed_age_minutes,
    latest_source_update.last_sync_at,
    FLOOR(
      EXTRACT(EPOCH FROM (statement_timestamp() - latest_source_update.last_sync_at))
    )::BIGINT AS sync_lag_seconds
  FROM event_summary
  CROSS JOIN latest_source_update;
END;
$$;

COMMENT ON FUNCTION safetrust.get_webhook_health_summary(JSONB)
  IS 'Admin health summary; non-admin results are restricted to their verified session tenant';
