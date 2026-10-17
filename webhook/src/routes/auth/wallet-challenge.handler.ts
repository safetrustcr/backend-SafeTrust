import { randomBytes, randomUUID } from 'node:crypto'
import { Response } from 'express'
import { connect } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'

const TENANT_ID = 'safetrust'
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const VALID_STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/

interface StellarUtils {
  validateStellarAddress(address: string): boolean
  verifyStellarEd25519(message: string, signature: string, address: string): boolean
}

let stellarUtils: StellarUtils | null = null
try {
  stellarUtils = require('../../../../crates/stellar-utils') as StellarUtils
} catch {
  // Fail closed during verification when the native Ed25519 verifier is unavailable.
}

function getWalletConfig(): { domain: string; network: string } | null {
  const domain = process.env.WALLET_CHALLENGE_DOMAIN?.trim().toLowerCase()
  if (!domain) return null
  return { domain, network: process.env.STELLAR_NETWORK ?? 'testnet' }
}

function isStellarAccount(address: unknown): address is string {
  if (typeof address !== 'string' || !VALID_STELLAR_ADDRESS.test(address)) return false
  return stellarUtils?.validateStellarAddress(address) ?? false
}

async function isSingleSignerAccount(address: string, network: string): Promise<boolean> {
  const horizon = network === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
  const response = await fetch(`${horizon}/accounts/${address}`)
  if (response.status === 404) return false
  if (!response.ok) throw new Error('Stellar account lookup failed')
  const account = await response.json() as {
    thresholds?: { low_threshold?: number; med_threshold?: number; high_threshold?: number }
    signers?: Array<{ key?: string; weight?: number }>
  }
  return account.thresholds?.low_threshold === 1
    && account.thresholds.med_threshold === 1
    && account.thresholds.high_threshold === 1
    && account.signers?.length === 1
    && account.signers[0].key === address
    && account.signers[0].weight === 1
}

function challengeMessage(input: {
  uid: string
  walletAddress: string
  tenant: string
  domain: string
  network: string
  nonce: string
  expiresAt: string
}): string {
  return JSON.stringify({
    purpose: 'SafeTrust wallet ownership verification',
    uid: input.uid,
    walletAddress: input.walletAddress,
    tenant: input.tenant,
    domain: input.domain,
    network: input.network,
    nonce: input.nonce,
    expiresAt: input.expiresAt,
  })
}

export async function createWalletChallengeHandler(
  req: AuthenticatedRequest & { body: { wallet_address?: unknown } },
  res: Response
): Promise<Response> {
  const { uid } = req.user!
  const address = req.body.wallet_address
  if (typeof address === 'string' && address.startsWith('C')) {
    return res.status(400).json({ error: 'UNSUPPORTED_STELLAR_ACCOUNT_TYPE' })
  }
  if (!isStellarAccount(address)) {
    return res.status(400).json({ error: 'INVALID_STELLAR_ACCOUNT' })
  }
  const config = getWalletConfig()
  if (!config) return res.status(503).json({ error: 'WALLET_CHALLENGE_NOT_CONFIGURED' })
  if (!stellarUtils?.verifyStellarEd25519) {
    return res.status(503).json({ error: 'WALLET_SIGNATURE_VERIFIER_UNAVAILABLE' })
  }

  try {
    if (!await isSingleSignerAccount(address, config.network)) {
      return res.status(400).json({ error: 'UNSUPPORTED_STELLAR_ACCOUNT_TYPE' })
    }
  } catch {
    console.error('[auth/wallet/challenge] Stellar account lookup failed')
    return res.status(503).json({ error: 'STELLAR_ACCOUNT_LOOKUP_FAILED' })
  }

  const challengeId = randomUUID()
  const nonce = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()
  const message = challengeMessage({
    uid,
    walletAddress: address,
    tenant: TENANT_ID,
    domain: config.domain,
    network: config.network,
    nonce,
    expiresAt,
  })

  try {
    // Expired rows are removed whenever a challenge is issued; the expires_at
    // index keeps this opportunistic TTL cleanup bounded as the table grows.
    const client = await connect()
    try {
      await client.query('DELETE FROM safetrust.wallet_challenges WHERE expires_at <= NOW()')
      await client.query(
        `INSERT INTO safetrust.wallet_challenges
          (challenge_id, user_id, wallet_address, tenant_id, domain, network, nonce, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [challengeId, uid, address, TENANT_ID, config.domain, config.network, nonce, expiresAt]
      )
    } finally {
      client.release()
    }
    return res.status(200).json({ challengeId, challenge: message, expiresAt })
  } catch (error: unknown) {
    console.error('[auth/wallet/challenge]', error instanceof Error ? error.message : 'database error')
    return res.status(500).json({ error: 'WALLET_CHALLENGE_FAILED' })
  }
}

export async function verifyWalletChallengeHandler(
  req: AuthenticatedRequest & { body: { challengeId?: unknown; signature?: unknown; is_primary?: unknown } },
  res: Response
): Promise<Response> {
  const { uid } = req.user!
  const { challengeId, signature, is_primary = false } = req.body
  if (typeof challengeId !== 'string' || !challengeId || typeof signature !== 'string' || !/^[a-fA-F0-9]{128}$/.test(signature)) {
    return res.status(400).json({ error: 'INVALID_WALLET_CHALLENGE_REQUEST' })
  }
  if (typeof is_primary !== 'boolean') return res.status(400).json({ error: 'INVALID_IS_PRIMARY' })
  if (!stellarUtils?.verifyStellarEd25519) return res.status(503).json({ error: 'WALLET_SIGNATURE_VERIFIER_UNAVAILABLE' })
  const config = getWalletConfig()
  if (!config) return res.status(503).json({ error: 'WALLET_CHALLENGE_NOT_CONFIGURED' })

  const client = await connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    const challengeResult = await client.query<{
      user_id: string
      wallet_address: string
      tenant_id: string
      domain: string
      network: string
      nonce: string
      expires_at: Date | string
    }>(
      `SELECT user_id, wallet_address, tenant_id, domain, network, nonce, expires_at
       FROM safetrust.wallet_challenges WHERE challenge_id = $1 FOR UPDATE`,
      [challengeId]
    )
    const challenge = challengeResult.rows[0]
    if (!challenge) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return res.status(409).json({ error: 'WALLET_CHALLENGE_ALREADY_USED_OR_UNKNOWN' })
    }
    if (challenge.user_id !== uid) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return res.status(401).json({ error: 'WALLET_CHALLENGE_USER_MISMATCH' })
    }
    const expiresAt = challenge.expires_at instanceof Date
      ? challenge.expires_at
      : new Date(challenge.expires_at)
    if (expiresAt.getTime() <= Date.now()) {
      await client.query('DELETE FROM safetrust.wallet_challenges WHERE challenge_id = $1', [challengeId])
      await client.query('COMMIT')
      transactionOpen = false
      return res.status(401).json({ error: 'WALLET_CHALLENGE_EXPIRED' })
    }
    if (challenge.tenant_id !== TENANT_ID || challenge.domain !== config.domain || challenge.network !== config.network) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return res.status(401).json({ error: 'WALLET_CHALLENGE_CONTEXT_MISMATCH' })
    }
    const message = challengeMessage({
      uid: challenge.user_id,
      walletAddress: challenge.wallet_address,
      tenant: challenge.tenant_id,
      domain: challenge.domain,
      network: challenge.network,
      nonce: challenge.nonce,
      expiresAt: expiresAt.toISOString(),
    })
    if (!stellarUtils.verifyStellarEd25519(message, signature, challenge.wallet_address)) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return res.status(401).json({ error: 'INVALID_WALLET_SIGNATURE' })
    }

    const existing = await client.query<{ user_id: string }>(
      'SELECT user_id FROM safetrust.user_wallets WHERE wallet_address = $1 FOR UPDATE',
      [challenge.wallet_address]
    )
    if (existing.rows[0] && existing.rows[0].user_id !== uid) {
      await client.query('DELETE FROM safetrust.wallet_challenges WHERE challenge_id = $1', [challengeId])
      await client.query('COMMIT')
      transactionOpen = false
      return res.status(409).json({ error: 'WALLET_ALREADY_REGISTERED' })
    }
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO safetrust.user_wallets (user_id, wallet_address, chain_type, is_primary)
         VALUES ($1, $2, 'STELLAR', $3)`,
        [uid, challenge.wallet_address, is_primary]
      )
    }
    await client.query('DELETE FROM safetrust.wallet_challenges WHERE challenge_id = $1', [challengeId])
    await client.query('COMMIT')
    transactionOpen = false
    return res.status(200).json({ success: true, wallet_address: challenge.wallet_address })
  } catch (error: unknown) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined)
    const code = (error as { code?: string }).code
    if (code === '23505') return res.status(409).json({ error: 'WALLET_ALREADY_REGISTERED' })
    console.error('[auth/wallet/verify]', error instanceof Error ? error.message : 'database error')
    return res.status(500).json({ error: 'WALLET_VERIFICATION_FAILED' })
  } finally {
    client.release()
  }
}
