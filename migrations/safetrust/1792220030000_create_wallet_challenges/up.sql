CREATE TABLE IF NOT EXISTS safetrust.wallet_challenges (
  challenge_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES safetrust.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  network TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expires_at
  ON safetrust.wallet_challenges (expires_at);
