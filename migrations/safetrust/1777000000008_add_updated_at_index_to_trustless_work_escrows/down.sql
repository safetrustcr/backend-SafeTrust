-- ============================================================
-- down.sql — Drop partial updated_at index on trustless_work_escrows
-- ============================================================

DROP INDEX IF EXISTS public.idx_trustless_escrows_updated_at;
