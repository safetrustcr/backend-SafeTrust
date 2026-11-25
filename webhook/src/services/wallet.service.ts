import type { PoolClient } from 'pg'
import { pool } from '../db/pool'
import { logger } from '../middleware/logger'
import {
  clearPrimaryWallets,
  deleteWalletChallenge,
  findWalletChallenge,
  findWalletForUser,
  findWalletOwner,
  insertVerifiedWallet,
  listWalletsForUpdate,
  lockUserWallets,
  promoteOldestWallet,
  setPrimaryWallet,
  unlinkWallet,
  WalletChallengeRow,
  WalletRow,
} from '../repositories/wallet.repository'

export interface WalletChallengeContext {
  tenant: string
  domain: string
  network: string
}

export type VerifyWalletChallengeResult =
  | { kind: 'unknown' }
  | { kind: 'user-mismatch' }
  | { kind: 'expired' }
  | { kind: 'context-mismatch' }
  | { kind: 'invalid-signature' }
  | { kind: 'already-registered' }
  | { kind: 'verified'; address: string }

function challengeDate(challenge: WalletChallengeRow): Date {
  return challenge.expires_at instanceof Date
    ? challenge.expires_at
    : new Date(challenge.expires_at)
}

export async function verifyWalletChallenge(input: {
  uid: string
  challengeId: string
  signature: string
  isPrimary: boolean
  context: WalletChallengeContext
  verifySignature: (message: string, signature: string, address: string) => boolean
  makeMessage: (input: {
    uid: string
    walletAddress: string
    tenant: string
    domain: string
    network: string
    nonce: string
    expiresAt: string
  }) => string
}): Promise<VerifyWalletChallengeResult> {
  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    const challenge = await findWalletChallenge(client, input.challengeId)
    if (!challenge) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'unknown' }
    }
    if (challenge.user_id !== input.uid) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'user-mismatch' }
    }

    const expiresAt = challengeDate(challenge)
    if (expiresAt.getTime() <= Date.now()) {
      await deleteWalletChallenge(client, input.challengeId)
      await client.query('COMMIT')
      transactionOpen = false
      return { kind: 'expired' }
    }
    if (
      challenge.tenant_id !== input.context.tenant ||
      challenge.domain !== input.context.domain ||
      challenge.network !== input.context.network
    ) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'context-mismatch' }
    }

    const message = input.makeMessage({
      uid: challenge.user_id,
      walletAddress: challenge.wallet_address,
      tenant: challenge.tenant_id,
      domain: challenge.domain,
      network: challenge.network,
      nonce: challenge.nonce,
      expiresAt: expiresAt.toISOString(),
    })
    if (!input.verifySignature(message, input.signature, challenge.wallet_address)) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'invalid-signature' }
    }

    const existing = await findWalletOwner(client, challenge.wallet_address)
    if (existing && existing.user_id !== input.uid) {
      await deleteWalletChallenge(client, input.challengeId)
      await client.query('COMMIT')
      transactionOpen = false
      return { kind: 'already-registered' }
    }
    if (!existing) {
      await insertVerifiedWallet(client, input.uid, challenge.wallet_address, input.isPrimary)
    }
    await deleteWalletChallenge(client, input.challengeId)
    await client.query('COMMIT')
    transactionOpen = false
    return { kind: 'verified', address: challenge.wallet_address }
  } catch (error) {
    if (transactionOpen) await rollback(client)
    throw error
  } finally {
    client.release()
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch (error) {
    logger.error('wallet.transaction.rollback_failed', { error })
  }
}

export async function unlinkUserWallet(
  uid: string,
  address: string
): Promise<'not-found' | 'unlinked'> {
  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    const wasPrimary = await unlinkWallet(client, uid, address)
    if (wasPrimary === null) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return 'not-found'
    }
    if (wasPrimary) await promoteOldestWallet(client, uid)
    await client.query('COMMIT')
    transactionOpen = false
    return 'unlinked'
  } catch (error) {
    if (transactionOpen) await rollback(client)
    throw error
  } finally {
    client.release()
  }
}

export type SetPrimaryWalletResult =
  | { kind: 'not-found' }
  | { kind: 'updated'; wallets: WalletRow[] }

export async function makeWalletPrimary(
  uid: string,
  address: string
): Promise<SetPrimaryWalletResult> {
  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    await lockUserWallets(client, uid)
    const target = await findWalletForUser(client, uid, address)
    if (!target) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'not-found' }
    }
    if (!target.is_primary) {
      await clearPrimaryWallets(client, uid)
      await setPrimaryWallet(client, uid, address)
    }
    const wallets = await listWalletsForUpdate(client, uid)
    await client.query('COMMIT')
    transactionOpen = false
    return { kind: 'updated', wallets }
  } catch (error) {
    if (transactionOpen) await rollback(client)
    throw error
  } finally {
    client.release()
  }
}
