import { Response } from 'express'
import { query } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type {
  ChainType,
  SyncWalletPayload,
  SyncWalletResponse,
} from '@safetrust/types'

const VALID_CHAIN_TYPES: readonly ChainType[] = ['ETH', 'STELLAR', 'BSC']

interface StellarUtils {
  validateStellarAddress(address: string): boolean
}

let nativeStellarUtils: StellarUtils | null = null
try {
  nativeStellarUtils = require('../../../../crates/stellar-utils') as StellarUtils
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(
    '[auth/sync-wallet] stellar-utils native addon unavailable, falling back to JS validation:',
    message
  )
}

function isStellarAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  if (nativeStellarUtils) return nativeStellarUtils.validateStellarAddress(address)
  return /^G[A-Z2-7]{55}$/.test(address)
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

interface WalletRow {
  wallet_address: string
}

export async function syncWalletHandler(
  req: AuthenticatedRequest & { body: Partial<SyncWalletPayload> },
  res: Response
): Promise<Response> {
  const { uid } = req.user
  const { wallet_address, chain_type, is_primary = false } = req.body

  if (!wallet_address || typeof wallet_address !== 'string') {
    return res.status(400).json({ error: 'wallet_address is required' })
  }
  if (!VALID_CHAIN_TYPES.includes(chain_type as ChainType)) {
    return res.status(400).json({ error: `chain_type must be one of: ${VALID_CHAIN_TYPES.join(', ')}` })
  }
  if (chain_type === 'STELLAR' && !isStellarAddress(wallet_address)) {
    return res.status(400).json({ error: 'Invalid Stellar wallet address' })
  }
  if (typeof is_primary !== 'boolean') {
    return res.status(400).json({ error: 'is_primary must be a boolean' })
  }

  try {
    const result = await query<WalletRow>(UPSERT_WALLET, [uid, wallet_address, chain_type, is_primary])
    const wallet = result.rows[0]

    console.log(`[auth/sync-wallet] uid=${uid} wallet=${wallet_address}`)
    const response: SyncWalletResponse = { success: true, wallet_address: wallet.wallet_address }
    return res.status(200).json(response)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[auth/sync-wallet]', message)
    return res.status(500).json({ error: 'Failed to sync wallet' })
  }
}