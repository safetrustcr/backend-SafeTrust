import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type {
  ChainType,
  SyncWalletPayload,
  SyncWalletResponse,
} from '@safetrust/types'
import { logger } from '../../middleware/logger'
import { syncWallet } from '../../repositories/wallet.repository'
import { AuthError, ConflictError, ValidationError } from '../../utils/errors'

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
    throw new AuthError('Unauthorized')
  }
  const { wallet_address, chain_type, is_primary = false } = req.body

  if (!wallet_address || typeof wallet_address !== 'string') {
    throw new ValidationError('wallet_address is required')
  }
  if (!VALID_CHAIN_TYPES.includes(chain_type as ChainType)) {
    throw new ValidationError(`chain_type must be one of: ${VALID_CHAIN_TYPES.join(', ')}`)
  }
  if (chain_type === 'STELLAR' && !isStellarAddress(wallet_address)) {
    throw new ValidationError('Invalid Stellar wallet address')
  }
  if (typeof is_primary !== 'boolean') {
    throw new ValidationError('is_primary must be a boolean')
  }
  if (
    chain_type === 'STELLAR' ||
    isStellarAddress(wallet_address) ||
    /^C[A-Z2-7]{55}$/.test(wallet_address)
  ) {
    throw new ValidationError('WALLET_CHALLENGE_REQUIRED', {
      code: 'wallet_challenge_required',
    })
  }

  const wallet = await syncWallet({
    uid,
    address: wallet_address,
    chainType: chain_type as ChainType,
    isPrimary: is_primary,
  })
  if (!wallet) {
    throw new ConflictError('WALLET_ALREADY_REGISTERED', { code: 'wallet_already_registered' })
  }

  logger.info('auth.sync_wallet.succeeded', { uid, walletAddress: wallet_address })
  const response: SyncWalletResponse = { success: true, wallet_address: wallet.wallet_address }
  return res.status(200).json(response)
}
