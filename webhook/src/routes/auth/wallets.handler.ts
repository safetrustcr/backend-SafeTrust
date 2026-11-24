import { createHash } from 'node:crypto'
import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { ChainType, ListWalletsResponse, WalletDto } from '../../domain'
import { logger } from '../../middleware/logger'
import { listWallets, WalletRow } from '../../repositories/wallet.repository'
import { makeWalletPrimary, unlinkUserWallet } from '../../services/wallet.service'

const STELLAR = /^[GC][A-Z2-7]{55}$/

export function toDto(row: WalletRow): WalletDto {
  return {
    address: row.wallet_address,
    chain: row.chain_type as ChainType,
    isPrimary: Boolean(row.is_primary),
    createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  }
}

export function isSignInWallet(uid: string, address: string): boolean {
  if (!uid?.startsWith('stellar_')) return false
  const hash = createHash('sha256').update(address).digest('hex')
  return `stellar_${hash}` === uid
}

export function signInWalletFor(uid: string, rows: WalletRow[]): string | null {
  if (!uid?.startsWith('stellar_')) return null
  for (const row of rows) {
    if (isSignInWallet(uid, row.wallet_address)) {
      return row.wallet_address
    }
  }
  return null
}

function getUserId(req: AuthenticatedRequest): string | null {
  return req.user?.uid || req.context?.uid || null
}

export async function listWalletsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const uid = getUserId(req)
  if (!uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  try {
    const rows = await listWallets(uid)

    const payload: ListWalletsResponse = {
      wallets: rows.map(toDto),
      signInWallet: signInWalletFor(uid, rows),
    }

    return res.status(200).json(payload)
  } catch (error: unknown) {
    logger.error('auth.wallets.list_failed', { error })
    return res.status(500).json({ error: 'WALLET_LIST_FAILED' })
  }
}

export async function unlinkWalletHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response | void> {
  const uid = getUserId(req)
  if (!uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  const address = req.params.address
  if (typeof address !== 'string' || !STELLAR.test(address)) {
    return res.status(400).json({ error: 'INVALID_WALLET_ADDRESS' })
  }

  if (isSignInWallet(uid, address)) {
    return res.status(409).json({ error: 'WALLET_IS_SIGN_IN_METHOD' })
  }

  try {
    const result = await unlinkUserWallet(uid, address)
    if (result === 'not-found') {
      return res.status(404).json({ error: 'WALLET_NOT_FOUND' })
    }
    logger.info('auth.wallets.unlinked', { uid })
    return res.status(204).end()
  } catch (error: unknown) {
    logger.error('auth.wallets.unlink_failed', { error })
    return res.status(500).json({ error: 'WALLET_UNLINK_FAILED' })
  }
}

export async function setPrimaryWalletHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const uid = getUserId(req)
  if (!uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  const address = req.params.address
  if (typeof address !== 'string' || !STELLAR.test(address)) {
    return res.status(400).json({ error: 'INVALID_WALLET_ADDRESS' })
  }

  try {
    const result = await makeWalletPrimary(uid, address)
    if (result.kind === 'not-found') {
      return res.status(404).json({ error: 'WALLET_NOT_FOUND' })
    }

    logger.info('auth.wallets.primary_set', { uid })

    const payload: ListWalletsResponse = {
      wallets: result.wallets.map(toDto),
      signInWallet: signInWalletFor(uid, result.wallets),
    }

    return res.status(200).json(payload)
  } catch (error: unknown) {
    logger.error('auth.wallets.primary_failed', { error })
    return res.status(500).json({ error: 'SET_PRIMARY_WALLET_FAILED' })
  }
}
