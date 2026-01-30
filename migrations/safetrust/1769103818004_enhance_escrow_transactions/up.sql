-- Add missing columns to escrow_transactions for subscription support
ALTER TABLE escrow_transactions
ADD COLUMN IF NOT EXISTS total_amount NUMERIC(20, 7),
ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS released_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS blockchain_tx_hash TEXT;

-- Add index for blockchain_tx_hash
CREATE INDEX IF NOT EXISTS idx_escrow_transactions_blockchain_tx_hash ON escrow_transactions(blockchain_tx_hash);

COMMENT ON COLUMN escrow_transactions.total_amount IS 'Total amount in escrow (sum of all participant amounts)';
COMMENT ON COLUMN escrow_transactions.activated_at IS 'Timestamp when escrow became active (all participants funded)';
COMMENT ON COLUMN escrow_transactions.released_at IS 'Timestamp when funds were released';
COMMENT ON COLUMN escrow_transactions.blockchain_tx_hash IS 'Blockchain transaction hash for release/refund';
