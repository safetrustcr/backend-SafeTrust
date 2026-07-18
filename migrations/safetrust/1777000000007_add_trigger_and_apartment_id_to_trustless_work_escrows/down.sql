-- ============================================================
-- down.sql — Revert updated_at trigger and apartment_id FK on trustless_work_escrows
-- ============================================================

DROP TRIGGER IF EXISTS trustless_work_escrows_set_updated_at
  ON public.trustless_work_escrows;

DROP FUNCTION IF EXISTS public.set_trustless_work_escrows_updated_at();

ALTER TABLE public.trustless_work_escrows
  DROP COLUMN IF EXISTS apartment_id;
