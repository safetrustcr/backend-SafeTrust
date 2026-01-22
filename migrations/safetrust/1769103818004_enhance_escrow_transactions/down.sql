DROP INDEX IF EXISTS idx_escrow_transactions_blockchain_tx_hash;
ALTER TABLE escrow_transactions
DROP COLUMN IF EXISTS total_amount,
DROP COLUMN IF EXISTS activated_at,
DROP COLUMN IF EXISTS released_at,
DROP COLUMN IF EXISTS blockchain_tx_hash;
