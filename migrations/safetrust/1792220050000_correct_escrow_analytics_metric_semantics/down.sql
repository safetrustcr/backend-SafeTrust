-- Restore the ANA-01 metric definitions and return types.

DROP FUNCTION IF EXISTS safetrust.get_escrow_analytics_by_day(DATE, DATE, VARCHAR);
DROP FUNCTION IF EXISTS safetrust.get_escrow_status_summary(VARCHAR);
DROP TABLE IF EXISTS safetrust.escrow_analytics_by_day;
DROP TABLE IF EXISTS safetrust.escrow_status_summary;

DROP INDEX IF EXISTS safetrust.idx_webhook_events_tenant_processed_at;
DROP INDEX IF EXISTS safetrust.idx_webhook_events_tenant_lifecycle_key;

CREATE TABLE safetrust.escrow_analytics_by_day (
  day             DATE,
  event_count     BIGINT,
  processed_count BIGINT,
  new_users       BIGINT,
  active_escrows  BIGINT,
  escrow_value    NUMERIC
);

CREATE TABLE safetrust.escrow_status_summary (
  total_escrows     BIGINT,
  active_escrows    BIGINT,
  completed_escrows BIGINT,
  disputed_escrows  BIGINT,
  total_value       NUMERIC,
  pending_value     NUMERIC
);

COMMENT ON TABLE safetrust.escrow_analytics_by_day
  IS 'Return type table for get_escrow_analytics_by_day() — never written to directly';

COMMENT ON TABLE safetrust.escrow_status_summary
  IS 'Return type table for get_escrow_status_summary() — never written to directly';

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
  events_by_day AS (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS event_count,
      COUNT(*) FILTER (WHERE processed = true) AS processed_count
    FROM safetrust.trustless_work_webhook_events
    WHERE tenant_id = p_tenant_id
      AND created_at >= range_start
      AND created_at <  range_end
    GROUP BY 1
  ),
  users_by_day AS (
    SELECT
      (last_seen AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) AS new_users
    FROM safetrust.users
    WHERE last_seen >= range_start
      AND last_seen <  range_end
    GROUP BY 1
  ),
  escrows_by_day AS (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*) FILTER (
        WHERE status IN ('funded', 'active', 'milestone_approved')
      ) AS active_escrows,
      COALESCE(SUM(amount) FILTER (
        WHERE status IN ('funded', 'active', 'milestone_approved')
      ), 0)::numeric AS escrow_value
    FROM safetrust.trustless_work_escrows
    WHERE tenant_id = p_tenant_id
      AND created_at >= range_start
      AND created_at <  range_end
    GROUP BY 1
  )
  SELECT
    ds.day,
    COALESCE(e.event_count, 0)     AS event_count,
    COALESCE(e.processed_count, 0) AS processed_count,
    COALESCE(u.new_users, 0)       AS new_users,
    COALESCE(ec.active_escrows, 0) AS active_escrows,
    COALESCE(ec.escrow_value, 0)   AS escrow_value
  FROM date_series ds
  LEFT JOIN events_by_day e   ON e.day  = ds.day
  LEFT JOIN users_by_day u    ON u.day  = ds.day
  LEFT JOIN escrows_by_day ec ON ec.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;

COMMENT ON FUNCTION safetrust.get_escrow_analytics_by_day(DATE, DATE, VARCHAR)
  IS 'Daily escrow analytics time series (UTC day buckets) exposed in GraphQL as getEscrowAnalyticsByDay';

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
    COALESCE(SUM(amount) FILTER (
      WHERE status NOT IN ('cancelled','resolved')
    ), 0)                                                                      AS total_value,
    COALESCE(SUM(amount) FILTER (
      WHERE status IN ('created','pending_funding')
    ), 0)                                                                      AS pending_value
  FROM safetrust.trustless_work_escrows
  WHERE tenant_id = tenant_id_input;
$$;

COMMENT ON FUNCTION safetrust.get_escrow_status_summary(VARCHAR)
  IS 'Aggregated escrow lifecycle counts and total value by status for dashboard metric cards';
