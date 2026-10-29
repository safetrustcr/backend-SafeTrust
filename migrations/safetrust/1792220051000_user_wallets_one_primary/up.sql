-- Enforce that a user can have at most one primary wallet across all chains
-- Keep only the oldest primary wallet per user before enforcing uniqueness
UPDATE safetrust.user_wallets w
   SET is_primary = false, updated_at = NOW()
 WHERE w.is_primary
   AND w.id <> (
     SELECT p.id
       FROM safetrust.user_wallets p
      WHERE p.user_id = w.user_id
        AND p.is_primary
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_one_primary
  ON safetrust.user_wallets(user_id)
  WHERE is_primary;
