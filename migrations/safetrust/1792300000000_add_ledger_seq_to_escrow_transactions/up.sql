-- Migration: Add ledger_seq to escrow_transactions
-- Description: Adds ledger_seq BIGINT NULL to escrow_transactions and trustless_work_escrows
--              to serve as the authoritative ordering token (Issue #661).
-- Invariants:
--  - Defaults to NULL for all existing rows (never assume NULL means stale)
--  - Preserves all existing rows without data loss
--  - Idempotent (safe to run multiple times via IF NOT EXISTS)

DO $$
BEGIN
    -- safetrust.escrow_transactions
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
    ) THEN
        ALTER TABLE safetrust.escrow_transactions 
        ADD COLUMN IF NOT EXISTS ledger_seq BIGINT NULL DEFAULT NULL;

        ALTER TABLE safetrust.escrow_transactions 
        ADD COLUMN IF NOT EXISTS balance NUMERIC(20, 7) DEFAULT 0;

        ALTER TABLE safetrust.escrow_transactions 
        ADD COLUMN IF NOT EXISTS network TEXT DEFAULT 'testnet';

        CREATE INDEX IF NOT EXISTS idx_escrow_transactions_ledger_seq 
        ON safetrust.escrow_transactions (ledger_seq);
    END IF;

    -- public.escrow_transactions (if still in public schema in any environment)
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'escrow_transactions'
    ) THEN
        ALTER TABLE public.escrow_transactions 
        ADD COLUMN IF NOT EXISTS ledger_seq BIGINT NULL DEFAULT NULL;

        ALTER TABLE public.escrow_transactions 
        ADD COLUMN IF NOT EXISTS balance NUMERIC(20, 7) DEFAULT 0;

        ALTER TABLE public.escrow_transactions 
        ADD COLUMN IF NOT EXISTS network TEXT DEFAULT 'testnet';

        CREATE INDEX IF NOT EXISTS idx_public_escrow_transactions_ledger_seq 
        ON public.escrow_transactions (ledger_seq);
    END IF;

    -- safetrust.trustless_work_escrows
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'safetrust' AND table_name = 'trustless_work_escrows'
    ) THEN
        ALTER TABLE safetrust.trustless_work_escrows 
        ADD COLUMN IF NOT EXISTS ledger_seq BIGINT NULL DEFAULT NULL;

        ALTER TABLE safetrust.trustless_work_escrows 
        ADD COLUMN IF NOT EXISTS network TEXT DEFAULT 'testnet';

        CREATE INDEX IF NOT EXISTS idx_trustless_work_escrows_ledger_seq 
        ON safetrust.trustless_work_escrows (ledger_seq);
    END IF;
END $$;
