DROP FUNCTION IF EXISTS public.get_escrow_status_summary(VARCHAR);

CREATE OR REPLACE FUNCTION public.get_escrow_status_summary(
  tenant_id_input VARCHAR(255) DEFAULT 'safetrust'
)
RETURNS SETOF public.escrow_status_summary
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
  FROM public.trustless_work_escrows
  WHERE tenant_id = tenant_id_input;
$$;

COMMENT ON FUNCTION public.get_escrow_status_summary(VARCHAR)
  IS 'Aggregated escrow lifecycle counts and total value by status for dashboard metric cards';