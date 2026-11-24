import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type {
  ChainType,
  SyncWalletPayload,
  SyncWalletResponse,
} from '../../domain'
import { logger } from '../../middleware/logger'
import { syncWallet } from '../../repositories/wallet.repository'

const VALID_CHAIN_TYPES: readonly ChainType[] = ['ETH', 'STELLAR', 'BSC']

interface StellarUtils {
  validateStellarAddress(address: string): boolean
}

let nativeStellarUtils: StellarUtils | null = null
try {
  nativeStellarUtils = require('../../../../crates/stellar-utils') as StellarUtils
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  logger.warn('auth.sync_wallet.native_addon_unavailable', {
    fallback: 'js-validation',
    error: message,
  })
}

function isStellarAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  if (nativeStellarUtils) return nativeStellarUtils.validateStellarAddress(address)
  return /^G[A-Z2-7]{55}$/.test(address)
}

export async function syncWalletHandler(
  req: AuthenticatedRequest & { body: Partial<SyncWalletPayload> },
  res: Response
): Promise<Response> {
  const uid = req.context?.uid || req.user?.uid
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
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
  if (
    chain_type === 'STELLAR' ||
    isStellarAddress(wallet_address) ||
    /^C[A-Z2-7]{55}$/.test(wallet_address)
  ) {
    return res.status(400).json({
      error: 'WALLET_CHALLENGE_REQUIRED',
      message: 'Use /auth/wallet/challenge and /auth/wallet/verify to register a Stellar wallet',
    })
  }

  try {
    const wallet = await syncWallet({
      uid,
      address: wallet_address,
      chainType: chain_type as ChainType,
      isPrimary: is_primary,
    })
    if (!wallet) {
      return res.status(409).json({ error: 'WALLET_ALREADY_REGISTERED' })
    }

    logger.info('auth.sync_wallet.succeeded', { uid, walletAddress: wallet_address })
    const response: SyncWalletResponse = { success: true, wallet_address: wallet.wallet_address }
    return res.status(200).json(response)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('auth.sync_wallet.failed', { error: message })
    return res.status(500).json({ error: 'Failed to sync wallet' })
  }
}
