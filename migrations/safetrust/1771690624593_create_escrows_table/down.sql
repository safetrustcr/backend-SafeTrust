-- ============================================================
-- down.sql — Drop escrow_transactions table and supporting objects
-- ============================================================

-- Drop trigger first (depends on function and table)
DROP TRIGGER IF EXISTS escrow_transactions_set_updated_at ON public.escrow_transactions;

-- Drop function
DROP FUNCTION IF EXISTS public.set_escrow_transactions_updated_at();

-- Drop indexes explicitly (dropped automatically with table, listed for clarity)
DROP INDEX IF EXISTS public.idx_escrow_transactions_contract_id;
DROP INDEX IF EXISTS public.idx_escrow_transactions_engagement_id;
DROP INDEX IF EXISTS public.idx_escrow_transactions_property_id;
DROP INDEX IF EXISTS public.idx_escrow_transactions_sender_address;
DROP INDEX IF EXISTS public.idx_escrow_transactions_receiver_address;
DROP INDEX IF EXISTS public.idx_escrow_transactions_status;
DROP INDEX IF EXISTS public.idx_escrow_transactions_tenant;

-- Drop table (cascades constraints)
DROP TABLE IF EXISTS public.escrow_transactions CASCADE;