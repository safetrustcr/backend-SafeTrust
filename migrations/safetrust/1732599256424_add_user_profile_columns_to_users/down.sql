-- Drop indexes
DROP INDEX IF EXISTS idx_escrow_transactions_bid;
DROP INDEX IF EXISTS idx_escrow_transactions_contract;
DROP INDEX IF EXISTS idx_escrow_transactions_status;
DROP INDEX IF EXISTS idx_escrow_transactions_type_status;
DROP INDEX IF EXISTS idx_escrow_xdr_transaction;
DROP INDEX IF EXISTS idx_escrow_api_calls_transaction;
DROP INDEX IF EXISTS idx_escrow_api_calls_status;

-- Drop tables
DROP TABLE IF EXISTS escrow_api_calls;
DROP TABLE IF EXISTS escrow_xdr_transactions;
DROP TABLE IF EXISTS escrow_transactions;

-- Drop types
DROP TYPE IF EXISTS escrow_transaction_type;
DROP TYPE IF EXISTS escrow_status;
DROP TYPE IF EXISTS xdr_status;