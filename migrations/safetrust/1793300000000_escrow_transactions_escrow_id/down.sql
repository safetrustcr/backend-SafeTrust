-- Rollback for 1793300000000_escrow_transactions_escrow_id.
-- Removes the reference and restores quarantined rows with their original
-- columns. Run the down migration of 1793400000000_drop_escrow_copies first
-- when that release has also been applied.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
  ) THEN
    RAISE NOTICE 'safetrust.escrow_transactions not found; nothing to roll back';
    RETURN;
  END IF;

  ALTER TABLE safetrust.escrow_transactions
    DROP CONSTRAINT IF EXISTS escrow_transactions_escrow_id_fkey;
  ALTER TABLE safetrust.escrow_transactions
    DROP CONSTRAINT IF EXISTS escrow_transactions_kind_check;

  DROP INDEX IF EXISTS safetrust.uq_escrow_transactions_escrow_kind_tx;
  DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_escrow_id;

  ALTER TABLE safetrust.escrow_transactions
    DROP COLUMN IF EXISTS kind;
  ALTER TABLE safetrust.escrow_transactions
    DROP COLUMN IF EXISTS escrow_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions_unmatched'
  ) THEN
    INSERT INTO safetrust.escrow_transactions (
      id, contract_id, engagement_id, property_id,
      sender_address, receiver_address, amount, status, unsigned_xdr,
      created_at, updated_at, tenant_id,
      ledger_seq, balance, network, tx_hash
    )
    SELECT
      id, contract_id, engagement_id, property_id,
      sender_address, receiver_address, amount, status, unsigned_xdr,
      created_at, updated_at, tenant_id,
      ledger_seq, balance, network, tx_hash
    FROM safetrust.escrow_transactions_unmatched
    WHERE NOT EXISTS (
      SELECT 1 FROM safetrust.escrow_transactions et
      WHERE et.id = safetrust.escrow_transactions_unmatched.id
    );

    DROP TABLE safetrust.escrow_transactions_unmatched;
  END IF;
END $$;
