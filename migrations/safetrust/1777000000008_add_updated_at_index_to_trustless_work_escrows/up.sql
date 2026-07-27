-- ============================================================
-- up.sql — Partial index on updated_at for O(log n + k) stale escrow lookup
-- ============================================================
-- Used by findStaleEscrows(): range scan on updated_at for non-terminal
-- safetrust escrows. Completed/resolved/cancelled rows are excluded so the
-- index stays small (terminal states dominate in production).

CREATE INDEX IF NOT EXISTS idx_trustless_escrows_updated_at
  ON public.trustless_work_escrows (updated_at)
  WHERE tenant_id = 'safetrust'
    AND status NOT IN ('completed', 'resolved', 'cancelled');
