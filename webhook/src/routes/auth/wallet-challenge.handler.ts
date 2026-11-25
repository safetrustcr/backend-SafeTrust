import { randomBytes, randomUUID } from 'node:crypto'
import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { createWalletChallenge } from '../../repositories/wallet.repository'
import { verifyWalletChallenge } from '../../services/wallet.service'
import { isStellarAccountAddress as isStellarAccount, verifyStellarEd25519 } from '../../lib/stellar-wallet'

const TENANT_ID = 'safetrust'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

function getWalletConfig(): { domain: string; network: string } | null {
  const domain = process.env.WALLET_CHALLENGE_DOMAIN?.trim().toLowerCase()
  if (!domain) return null
  return { domain, network: process.env.STELLAR_NETWORK ?? 'testnet' }
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
  const signer = account.signers?.length === 1 ? account.signers[0] : undefined
  const weight = signer?.weight ?? 0
  const t = account.thresholds ?? {}
  return signer?.key === address
    && weight > 0
    && (t.low_threshold ?? 0) <= weight
    && (t.med_threshold ?? 0) <= weight
    && (t.high_threshold ?? 0) <= weight
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

  try {
    if (!await isSingleSignerAccount(address, config.network)) {
      return res.status(400).json({ error: 'UNSUPPORTED_STELLAR_ACCOUNT_TYPE' })
    }
  } catch {
    logger.error('auth.wallet_challenge.account_lookup_failed')
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
    await createWalletChallenge({
      challengeId,
      uid,
      address,
      tenantId: TENANT_ID,
      domain: config.domain,
      network: config.network,
      nonce,
      expiresAt,
    })
    return res.status(200).json({ challengeId, challenge: message, expiresAt })
  } catch (error: unknown) {
    logger.error('auth.wallet_challenge.failed', { error })
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
  const config = getWalletConfig()
  if (!config) return res.status(503).json({ error: 'WALLET_CHALLENGE_NOT_CONFIGURED' })

  try {
    const result = await verifyWalletChallenge({
      uid,
      challengeId,
      signature,
      isPrimary: is_primary,
      context: { tenant: TENANT_ID, domain: config.domain, network: config.network },
      verifySignature: verifyStellarEd25519,
      makeMessage: challengeMessage,
    })
    switch (result.kind) {
      case 'unknown':
        return res.status(409).json({ error: 'WALLET_CHALLENGE_ALREADY_USED_OR_UNKNOWN' })
      case 'user-mismatch':
        return res.status(401).json({ error: 'WALLET_CHALLENGE_USER_MISMATCH' })
      case 'expired':
        return res.status(401).json({ error: 'WALLET_CHALLENGE_EXPIRED' })
      case 'context-mismatch':
        return res.status(401).json({ error: 'WALLET_CHALLENGE_CONTEXT_MISMATCH' })
      case 'invalid-signature':
        return res.status(401).json({ error: 'INVALID_WALLET_SIGNATURE' })
      case 'already-registered':
        return res.status(409).json({ error: 'WALLET_ALREADY_REGISTERED' })
      case 'verified':
        return res.status(200).json({ success: true, wallet_address: result.address })
    }
  } catch (error: unknown) {
    const code = (error as { code?: string }).code
    if (code === '23505') return res.status(409).json({ error: 'WALLET_ALREADY_REGISTERED' })
    logger.error('auth.wallet_verify.failed', { error })
    return res.status(500).json({ error: 'WALLET_VERIFICATION_FAILED' })
  }
}
