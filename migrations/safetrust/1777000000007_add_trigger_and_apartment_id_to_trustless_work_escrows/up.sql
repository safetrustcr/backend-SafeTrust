-- ============================================================
-- up.sql — Add updated_at trigger and apartment_id FK to trustless_work_escrows
-- ============================================================

-- 1. Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION public.set_trustless_work_escrows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trustless_work_escrows_set_updated_at
  ON public.trustless_work_escrows;

CREATE TRIGGER trustless_work_escrows_set_updated_at
  BEFORE UPDATE ON public.trustless_work_escrows
  FOR EACH ROW EXECUTE FUNCTION public.set_trustless_work_escrows_updated_at();

-- 2. apartment_id FK (nullable — existing rows unaffected)
ALTER TABLE public.trustless_work_escrows
  ADD COLUMN IF NOT EXISTS apartment_id UUID
  REFERENCES public.apartments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trustless_escrows_apartment_id
  ON public.trustless_work_escrows(apartment_id);

COMMENT ON COLUMN public.trustless_work_escrows.apartment_id
  IS 'FK to apartments — the safetrust property this escrow covers';
