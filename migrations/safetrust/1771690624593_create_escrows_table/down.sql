-- ============================================================
-- down.sql — Drop escrows table and supporting objects
-- ============================================================

-- Drop trigger first (depends on function and table)
DROP TRIGGER IF EXISTS escrows_set_updated_at ON public.escrows;

-- Drop function
DROP FUNCTION IF EXISTS public.set_escrows_updated_at();

-- Drop indexes explicitly (dropped automatically with table, listed for clarity)
DROP INDEX IF EXISTS public.idx_escrows_contract_id;
DROP INDEX IF EXISTS public.idx_escrows_engagement_id;
DROP INDEX IF EXISTS public.idx_escrows_property_id;
DROP INDEX IF EXISTS public.idx_escrows_sender_address;
DROP INDEX IF EXISTS public.idx_escrows_receiver_address;
DROP INDEX IF EXISTS public.idx_escrows_status;
DROP INDEX IF EXISTS public.idx_escrows_tenant;

-- Drop table (cascades constraints)
DROP TABLE IF EXISTS public.escrows CASCADE;