-- Return type tables for Hasura-trackable analytics functions
-- These tables are never written to — they exist solely to define
-- the composite return type that Hasura requires for SETOF functions

CREATE TABLE IF NOT EXISTS public.escrow_analytics_by_day (
  day             DATE,
  event_count     BIGINT,
  processed_count BIGINT,
  new_users       BIGINT,
  active_escrows  BIGINT,
  escrow_value    NUMERIC
);

CREATE TABLE IF NOT EXISTS public.escrow_status_summary (
  total_escrows     BIGINT,
  active_escrows    BIGINT,
  completed_escrows BIGINT,
  disputed_escrows  BIGINT,
  total_value       NUMERIC,
  pending_value     NUMERIC
);

COMMENT ON TABLE public.escrow_analytics_by_day
  IS 'Return type table for get_escrow_analytics_by_day() — never written to directly';

COMMENT ON TABLE public.escrow_status_summary
  IS 'Return type table for get_escrow_status_summary() — never written to directly';