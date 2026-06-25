const db = require('../../services/db');

const VALID_CHAIN_TYPES = ['ETH', 'STELLAR', 'BSC'];

// Stellar public key: 'G' + 55 base32 chars (A-Z2-7), total 56 chars
function isStellarAddress(addr) {
  return typeof addr === 'string' && /^G[A-Z2-7]{55}$/.test(addr);
}

const UPSERT_WALLET = `
  INSERT INTO public.user_wallets (user_id, wallet_address, chain_type, is_primary)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (wallet_address)
  DO UPDATE SET user_id = EXCLUDED.user_id, is_primary = EXCLUDED.is_primary, updated_at = NOW()
  RETURNING id, wallet_address, chain_type, is_primary
`;

async function syncWalletHandler(req, res) {
  const { uid } = req.user;
  const { wallet_address, chain_type, is_primary = false } = req.body;

  if (!wallet_address || typeof wallet_address !== 'string') {
    return res.status(400).json({ error: 'wallet_address is required' });
  }
  if (!VALID_CHAIN_TYPES.includes(chain_type)) {
    return res.status(400).json({ error: `chain_type must be one of: ${VALID_CHAIN_TYPES.join(', ')}` });
  }
  if (chain_type === 'STELLAR' && !isStellarAddress(wallet_address)) {
    return res.status(400).json({ error: 'Invalid Stellar wallet address' });
  }
  if (typeof is_primary !== 'boolean') {
    return res.status(400).json({ error: 'is_primary must be a boolean' });
  }

  try {
    const result = await db.query(UPSERT_WALLET, [uid, wallet_address, chain_type, is_primary]);
    const wallet = result.rows[0];

    console.log(`[auth/sync-wallet] ✅ uid=${uid} wallet=${wallet_address}`);
    return res.status(200).json({ success: true, wallet_address: wallet.wallet_address });
  } catch (error) {
    console.error('[auth/sync-wallet] ❌', error.message);
    return res.status(500).json({ error: 'Failed to sync wallet' });
  }
}

module.exports = { syncWalletHandler };
