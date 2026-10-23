import { createHash } from 'node:crypto'
import { Response } from 'express'
import { connect, query } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { ChainType, ListWalletsResponse, WalletDto } from '@safetrust/types'

const STELLAR = /^[GC][A-Z2-7]{55}$/

export interface WalletRow {
  wallet_address: string
  chain_type: string
  is_primary: boolean
  created_at: Date | string
}

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
    const { rows } = await query<WalletRow>(
      `SELECT wallet_address, chain_type, is_primary, created_at
         FROM safetrust.user_wallets WHERE user_id = $1
        ORDER BY is_primary DESC, created_at ASC`,
      [uid]
    )

    const payload: ListWalletsResponse = {
      wallets: rows.map(toDto),
      signInWallet: signInWalletFor(uid, rows),
    }

    return res.status(200).json(payload)
  } catch (error: unknown) {
    console.error('[auth/wallets/list]', error instanceof Error ? error.message : 'database error')
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

  const client = await connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true

    const del = await client.query<{ is_primary: boolean }>(
      `DELETE FROM safetrust.user_wallets WHERE user_id = $1 AND wallet_address = $2 RETURNING is_primary`,
      [uid, address]
    )

    if (del.rowCount === 0) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return res.status(404).json({ error: 'WALLET_NOT_FOUND' })
    }

    if (del.rows[0]?.is_primary) {
      // Promote the oldest remaining wallet
      await client.query(
        `UPDATE safetrust.user_wallets SET is_primary = true, updated_at = NOW()
          WHERE id = (SELECT id FROM safetrust.user_wallets WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1)`,
        [uid]
      )
    }

    await client.query('COMMIT')
    transactionOpen = false
    console.info(`[auth/wallets] Unlinked wallet for user ${uid}`)
    return res.status(204).end()
  } catch (error: unknown) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined)
    }
    console.error('[auth/wallets/unlink]', error instanceof Error ? error.message : 'database error')
    return res.status(500).json({ error: 'WALLET_UNLINK_FAILED' })
  } finally {
    client.release()
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

  const client = await connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true

    await client.query(
      `SELECT id FROM safetrust.user_wallets WHERE user_id = $1 ORDER BY id FOR UPDATE`,
      [uid]
    )

    const check = await client.query<{ id: string; is_primary: boolean }>(
      `SELECT id, is_primary FROM safetrust.user_wallets
        WHERE user_id = $1 AND wallet_address = $2 FOR UPDATE`,
      [uid, address]
    )

    if (check.rowCount === 0) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return res.status(404).json({ error: 'WALLET_NOT_FOUND' })
    }

    if (!check.rows[0]?.is_primary) {
      await client.query(
        `UPDATE safetrust.user_wallets SET is_primary = false, updated_at = NOW()
          WHERE user_id = $1 AND is_primary = true`,
        [uid]
      )
      await client.query(
        `UPDATE safetrust.user_wallets SET is_primary = true, updated_at = NOW()
          WHERE user_id = $1 AND wallet_address = $2`,
        [uid, address]
      )
    }

    const { rows } = await client.query<WalletRow>(
      `SELECT wallet_address, chain_type, is_primary, created_at
         FROM safetrust.user_wallets WHERE user_id = $1
        ORDER BY is_primary DESC, created_at ASC`,
      [uid]
    )

    await client.query('COMMIT')
    transactionOpen = false
    console.info(`[auth/wallets] Set primary wallet for user ${uid}`)

    const payload: ListWalletsResponse = {
      wallets: rows.map(toDto),
      signInWallet: signInWalletFor(uid, rows),
    }

    return res.status(200).json(payload)
  } catch (error: unknown) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined)
    }
    console.error('[auth/wallets/primary]', error instanceof Error ? error.message : 'database error')
    return res.status(500).json({ error: 'SET_PRIMARY_WALLET_FAILED' })
  } finally {
    client.release()
  }
}
