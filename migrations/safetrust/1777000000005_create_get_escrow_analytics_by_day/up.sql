-- Migration: get_escrow_analytics_by_day
-- Daily event aggregation for the Analytics Dashboard (Hasura query root).
-- Joins webhook events, users (last_seen), and trustless_work_escrows into a
-- contiguous date series so charts have no gaps.

CREATE OR REPLACE FUNCTION public.get_escrow_analytics_by_day(
  start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  end_date   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id_input VARCHAR(255) DEFAULT 'safetrust'
)
RETURNS TABLE(
  day             DATE,
  event_count     BIGINT,   -- total webhook events (maps to pageViews in chart)
  processed_count BIGINT,   -- processed events (maps to clicks/interactions)
  new_users       BIGINT,   -- users seen that day (maps to users series)
  active_escrows  BIGINT,   -- escrows with status funded/active on that day
  escrow_value    NUMERIC   -- total amount of active escrows on that day
)
LANGUAGE sql
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      start_date::date,
      end_date::date,
      '1 day'::interval
    )::date AS day
  ),
  events_by_day AS (
    SELECT
      created_at::date AS day,
      COUNT(*) AS event_count,
      COUNT(*) FILTER (WHERE processed = true) AS processed_count
    FROM public.trustless_work_webhook_events
    WHERE
      tenant_id = tenant_id_input
      AND created_at >= start_date::date
      AND created_at < (end_date::date + INTERVAL '1 day')
    GROUP BY created_at::date
  ),
  users_by_day AS (
    SELECT
      DATE(last_seen) AS day,
      COUNT(*) AS new_users
    FROM public.users
    WHERE
      last_seen >= start_date::date
      AND last_seen < (end_date::date + INTERVAL '1 day')
    GROUP BY DATE(last_seen)
  ),
  escrows_by_day AS (
    SELECT
      created_at::date AS day,
      COUNT(*) FILTER (
        WHERE status IN ('funded', 'active', 'milestone_approved')
      ) AS active_escrows,
      COALESCE(SUM(amount) FILTER (
        WHERE status IN ('funded', 'active', 'milestone_approved')
      ), 0) AS escrow_value
    FROM public.trustless_work_escrows
    WHERE
      tenant_id = tenant_id_input
      AND created_at >= start_date::date
      AND created_at < (end_date::date + INTERVAL '1 day')
    GROUP BY created_at::date
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
$$;

COMMENT ON FUNCTION public.get_escrow_analytics_by_day(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR)
  IS 'Daily escrow analytics time series for the SafeTrust Analytics Dashboard';
