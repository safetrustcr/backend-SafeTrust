-- Drop indexes
DROP INDEX IF EXISTS idx_users_wallets_user_id;
DROP INDEX IF EXISTS idx_users_wallets_wallet_address;
DROP INDEX IF EXISTS idx_users_wallets_is_primary;

-- Drop users_wallets table
DROP TABLE IF EXISTS users_wallets;