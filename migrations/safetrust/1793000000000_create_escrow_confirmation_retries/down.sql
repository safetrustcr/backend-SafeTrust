DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_tx_hash;
ALTER TABLE safetrust.escrow_transactions
  DROP COLUMN IF EXISTS network,
  DROP COLUMN IF EXISTS tx_hash;

DROP INDEX IF EXISTS safetrust.idx_trustless_escrows_tx_hash;
ALTER TABLE safetrust.trustless_work_escrows
  DROP COLUMN IF EXISTS network,
  DROP COLUMN IF EXISTS tx_hash;

DROP TABLE IF EXISTS safetrust.escrow_confirmation_retries;
