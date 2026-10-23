-- ANA-03: correct the time basis, deduplication and currency policy of every
-- analytics metric. Definitions are documented in docs/analytics/metrics.md.
--
-- Metrics whose meaning changed are renamed so no caller keeps reading a new
-- number under an old label:
--
--   get_escrow_analytics_by_day
--     event_count     -> webhook_records (raw rows) + lifecycle_events (deduplicated)
--     processed_count -> processed_events (bucketed by processed_at, not created_at)
--     new_users       -> last_active_users (users.last_seen is the only timestamp)
--     active_escrows  -> escrows_created + cohort_active_escrows (creation cohort)
--     escrow_value    -> cohort_active_value_usdc (single-asset policy: USDC only)
--
--   get_escrow_status_summary
--     total_value     -> total_value_usdc (every status except cancelled, USDC only)
--     pending_value   -> pending_value_usdc (USDC only)
--
-- The tenant argument is kept as-is from ANA-01; ANA-02 replaces it with the
-- session-derived scope without touching the metric CTEs below.

-- Return-type tables are never written to, so they are rebuilt rather than
-- altered; the functions that depend on their row types go first.
DROP FUNCTION IF EXISTS safetrust.get_escrow_analytics_by_day(DATE, DATE, VARCHAR);
DROP FUNCTION IF EXISTS safetrust.get_escrow_status_summary(VARCHAR);
DROP TABLE IF EXISTS safetrust.escrow_analytics_by_day;
DROP TABLE IF EXISTS safetrust.escrow_status_summary;

CREATE TABLE safetrust.escrow_analytics_by_day (
  day                      DATE,
  webhook_records          BIGINT,
  lifecycle_events         BIGINT,
  processed_events         BIGINT,
  last_active_users        BIGINT,
  escrows_created          BIGINT,
  cohort_active_escrows    BIGINT,
  cohort_active_value_usdc NUMERIC
);

CREATE TABLE safetrust.escrow_status_summary (
  total_escrows      BIGINT,
  active_escrows     BIGINT,
  completed_escrows  BIGINT,
  disputed_escrows   BIGINT,
  total_value_usdc   NUMERIC,
  pending_value_usdc NUMERIC
);

COMMENT ON TABLE safetrust.escrow_analytics_by_day
  IS 'Return type table for get_escrow_analytics_by_day() — never written to directly';

COMMENT ON TABLE safetrust.escrow_status_summary
  IS 'Return type table for get_escrow_status_summary() — never written to directly';

-- processed_events buckets by processed_at; lifecycle_events needs the first
-- received row per (contract_id, event_type).
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_processed_at
  ON safetrust.trustless_work_webhook_events (tenant_id, processed_at)
  WHERE processed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_lifecycle_key
  ON safetrust.trustless_work_webhook_events (tenant_id, contract_id, event_type, created_at);

CREATE FUNCTION safetrust.get_escrow_analytics_by_day(
  p_start_date DATE,
  p_end_date   DATE,
  p_tenant_id  VARCHAR(255)
)
RETURNS SETOF safetrust.escrow_analytics_by_day
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  range_start TIMESTAMPTZ;
  range_end   TIMESTAMPTZ;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR NULLIF(btrim(p_tenant_id), '') IS NULL THEN
    RAISE EXCEPTION 'p_start_date, p_end_date and p_tenant_id are required'
      USING ERRCODE = '22004';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'p_end_date (%) must not be before p_start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  IF p_end_date - p_start_date > 366 THEN
    RAISE EXCEPTION 'date range must not exceed 366 days'
      USING ERRCODE = '22023';
  END IF;

  range_start := p_start_date::timestamp AT TIME ZONE 'UTC';
  range_end   := (p_end_date + 1)::timestamp AT TIME ZONE 'UTC';

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(p_start_date, p_end_date, INTERVAL '1 day')::date AS day
  ),
  -- Every stored webhook row, duplicates and redeliveries included.
  records_by_day AS (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS webhook_records
    FROM safetrust.trustless_work_webhook_events
    WHERE tenant_id = p_tenant_id
      AND created_at >= range_start
      AND created_at <  range_end
    GROUP BY 1
  ),
  -- One lifecycle event per (contract_id, event_type), the key the webhook
  -- handler deduplicates on, counted on the day it was first received.
  -- Rows without a contract_id cannot be deduplicated and count individually.
  lifecycle_first_seen AS (
    SELECT MIN(created_at) AS first_received_at
    FROM safetrust.trustless_work_webhook_events
    WHERE tenant_id = p_tenant_id
      AND created_at < range_end
    GROUP BY COALESCE(contract_id, id::text), event_type
  ),
  lifecycle_by_day AS (
    SELECT
      (first_received_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS lifecycle_events
    FROM lifecycle_first_seen
    WHERE first_received_at >= range_start
    GROUP BY 1
  ),
  -- Bucketed by when processing succeeded, so a late retry adds to the day it
  -- succeeded instead of rewriting the day the webhook arrived.
  processed_by_day AS (
    SELECT
      (processed_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS processed_events
    FROM safetrust.trustless_work_webhook_events
    WHERE tenant_id = p_tenant_id
      AND processed = true
      AND processed_at >= range_start
      AND processed_at <  range_end
    GROUP BY 1
  ),
  -- users.last_seen is mutable: a user is counted only on their most recent
  -- activity day and moves forward when they return. safetrust.users is
  -- tenant-scoped by schema and has no tenant_id column.
  users_by_day AS (
    SELECT
      (last_seen AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS last_active_users
    FROM safetrust.users
    WHERE last_seen >= range_start
      AND last_seen <  range_end
    GROUP BY 1
  ),
  -- Creation cohort: escrows created on the day, and how many of that cohort
  -- are active now. Not a point-in-time count of active escrows.
  escrows_by_day AS (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS escrows_created,
      COUNT(*) FILTER (
        WHERE status IN ('funded', 'active', 'milestone_approved')
      ) AS cohort_active_escrows,
      COALESCE(SUM(amount) FILTER (
        WHERE status IN ('funded', 'active', 'milestone_approved')
          AND asset_code = 'USDC'
      ), 0)::numeric AS cohort_active_value_usdc
    FROM safetrust.trustless_work_escrows
    WHERE tenant_id = p_tenant_id
      AND created_at >= range_start
      AND created_at <  range_end
    GROUP BY 1
  )
  SELECT
    ds.day,
    COALESCE(r.webhook_records, 0)            AS webhook_records,
    COALESCE(l.lifecycle_events, 0)           AS lifecycle_events,
    COALESCE(p.processed_events, 0)           AS processed_events,
    COALESCE(u.last_active_users, 0)          AS last_active_users,
    COALESCE(ec.escrows_created, 0)           AS escrows_created,
    COALESCE(ec.cohort_active_escrows, 0)     AS cohort_active_escrows,
    COALESCE(ec.cohort_active_value_usdc, 0)  AS cohort_active_value_usdc
  FROM date_series ds
  LEFT JOIN records_by_day r   ON r.day  = ds.day
  LEFT JOIN lifecycle_by_day l ON l.day  = ds.day
  LEFT JOIN processed_by_day p ON p.day  = ds.day
  LEFT JOIN users_by_day u     ON u.day  = ds.day
  LEFT JOIN escrows_by_day ec  ON ec.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;

COMMENT ON FUNCTION safetrust.get_escrow_analytics_by_day(DATE, DATE, VARCHAR)
  IS 'Daily escrow analytics time series (UTC day buckets); metric definitions in docs/analytics/metrics.md';

CREATE FUNCTION safetrust.get_escrow_status_summary(
  tenant_id_input VARCHAR(255) DEFAULT 'safetrust'
)
RETURNS SETOF safetrust.escrow_status_summary
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)                                                                   AS total_escrows,
    COUNT(*) FILTER (WHERE status IN ('funded','active','milestone_approved')) AS active_escrows,
    COUNT(*) FILTER (WHERE status = 'completed')                               AS completed_escrows,
    COUNT(*) FILTER (WHERE status = 'disputed')                                AS disputed_escrows,
    -- Nominal value of every escrow that was not cancelled. Cancelled escrows
    -- never settled; resolved escrows did, like completed ones, so both count.
    COALESCE(SUM(amount) FILTER (
      WHERE status <> 'cancelled' AND asset_code = 'USDC'
    ), 0)                                                                      AS total_value_usdc,
    COALESCE(SUM(amount) FILTER (
      WHERE status IN ('created','pending_funding') AND asset_code = 'USDC'
    ), 0)                                                                      AS pending_value_usdc
  FROM safetrust.trustless_work_escrows
  WHERE tenant_id = tenant_id_input;
$$;

COMMENT ON FUNCTION safetrust.get_escrow_status_summary(VARCHAR)
  IS 'Escrow lifecycle counts and nominal USDC value; metric definitions in docs/analytics/metrics.md';
