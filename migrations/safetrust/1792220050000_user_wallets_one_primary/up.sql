-- Enforce that a user can have at most one primary wallet across all chains
CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_one_primary
  ON safetrust.user_wallets(user_id)
  WHERE is_primary;
