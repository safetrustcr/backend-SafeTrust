-- Revert migration: Remove ledger_seq from escrow_transactions
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
    ) THEN
        DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_ledger_seq;
        ALTER TABLE safetrust.escrow_transactions DROP COLUMN IF EXISTS ledger_seq;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'escrow_transactions'
    ) THEN
        DROP INDEX IF EXISTS public.idx_public_escrow_transactions_ledger_seq;
        ALTER TABLE public.escrow_transactions DROP COLUMN IF EXISTS ledger_seq;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'safetrust' AND table_name = 'trustless_work_escrows'
    ) THEN
        DROP INDEX IF EXISTS safetrust.idx_trustless_work_escrows_ledger_seq;
        ALTER TABLE safetrust.trustless_work_escrows DROP COLUMN IF EXISTS ledger_seq;
    END IF;
END $$;
