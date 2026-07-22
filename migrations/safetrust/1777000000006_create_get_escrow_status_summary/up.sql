-- ============================================================================
-- Escrow status summary aggregation for dashboard metric cards
-- Returns a single row with lifecycle counts and total value by status so the
-- frontend can populate all metric cards in one round-trip.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_escrow_status_summary(
  tenant_id_input VARCHAR(255) DEFAULT 'safetrust'
)
RETURNS TABLE(
  total_escrows     BIGINT,
  active_escrows    BIGINT,   -- funded + active + milestone_approved
  completed_escrows BIGINT,
  disputed_escrows  BIGINT,
  total_value       NUMERIC,  -- SUM(amount) excluding cancelled/resolved
  pending_value     NUMERIC   -- SUM(amount) WHERE status = 'created' or 'pending_funding'
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)                                                          AS total_escrows,
    COUNT(*) FILTER (WHERE status IN ('funded','active','milestone_approved')) AS active_escrows,
    COUNT(*) FILTER (WHERE status = 'completed')                     AS completed_escrows,
    COUNT(*) FILTER (WHERE status = 'disputed')                      AS disputed_escrows,
    COALESCE(SUM(amount) FILTER (
      WHERE status NOT IN ('cancelled','resolved')
    ), 0)                                                            AS total_value,
    COALESCE(SUM(amount) FILTER (
      WHERE status IN ('created','pending_funding')
    ), 0)                                                            AS pending_value
  FROM public.trustless_work_escrows
  WHERE tenant_id = tenant_id_input;
$$;

COMMENT ON FUNCTION public.get_escrow_status_summary(VARCHAR)
  IS 'Aggregated escrow lifecycle counts and total value by status for dashboard metric cards. Returns a single row.';
