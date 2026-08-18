import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import db from '../../services/db'

const VALID_CHAIN_TYPES = ['ETH', 'STELLAR', 'BSC'] as const
type ChainType = (typeof VALID_CHAIN_TYPES)[number]

interface SyncWalletBody {
  wallet_address?: string
  chain_type?: ChainType
  is_primary?: boolean
}

interface UserWalletRow {
  id: string
  wallet_address: string
  chain_type: string
  is_primary: boolean
}

let nativeStellarUtils: { validateStellarAddress: (addr: string) => boolean } | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeStellarUtils = require('../../../crates/stellar-utils')
} catch (err) {
  const error = err as Error
  console.warn(
    '[auth/sync-wallet] ⚠️ stellar-utils native addon unavailable, falling back to JS validation:',
    error.message
  )
}

function isStellarAddress(addr: unknown): boolean {
  if (typeof addr !== 'string') return false
  if (nativeStellarUtils) return nativeStellarUtils.validateStellarAddress(addr)
  return /^G[A-Z2-7]{55}$/.test(addr)
}

const UPSERT_WALLET = `
  INSERT INTO public.user_wallets (user_id, wallet_address, chain_type, is_primary)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (wallet_address)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    chain_type = EXCLUDED.chain_type,
    is_primary = EXCLUDED.is_primary,
    updated_at = NOW()
  RETURNING id, wallet_address, chain_type, is_primary
`

export const syncWalletHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { uid } = req.user
  const { wallet_address, chain_type, is_primary = false } = (req.body ?? {}) as SyncWalletBody

  if (!wallet_address || typeof wallet_address !== 'string') {
    return res.status(400).json({ error: 'wallet_address is required' })
  }
  if (!chain_type || !VALID_CHAIN_TYPES.includes(chain_type as ChainType)) {
    return res.status(400).json({ error: `chain_type must be one of: ${VALID_CHAIN_TYPES.join(', ')}` })
  }
  if (chain_type === 'STELLAR' && !isStellarAddress(wallet_address)) {
    return res.status(400).json({ error: 'Invalid Stellar wallet address' })
  }
  if (typeof is_primary !== 'boolean') {
    return res.status(400).json({ error: 'is_primary must be a boolean' })
  }

  try {
    const result = await db.query<UserWalletRow>(UPSERT_WALLET, [uid, wallet_address, chain_type, is_primary])
    const wallet = result.rows[0]

    console.log(`[auth/sync-wallet] ✅ uid=${uid} wallet=${wallet_address}`)
    return res.status(200).json({ success: true, wallet_address: wallet.wallet_address })
  } catch (error) {
    const err = error as Error
    console.error('[auth/sync-wallet] ❌', err.message)
    return res.status(500).json({ error: 'Failed to sync wallet' })
  }
}
