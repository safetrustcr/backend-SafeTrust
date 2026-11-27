import { randomBytes, randomUUID } from 'node:crypto'
import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { createWalletChallenge } from '../../repositories/wallet.repository'
import { verifyWalletChallenge } from '../../services/wallet.service'
import { isStellarAccountAddress as isStellarAccount, verifyStellarEd25519 } from '../../lib/stellar-wallet'
import {
  AuthError,
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from '../../utils/errors'

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
    throw new ValidationError('UNSUPPORTED_STELLAR_ACCOUNT_TYPE', { code: 'unsupported_stellar_account_type' })
  }
  if (!isStellarAccount(address)) {
    throw new ValidationError('INVALID_STELLAR_ACCOUNT', { code: 'invalid_stellar_account' })
  }
  const config = getWalletConfig()
  if (!config) return res.status(503).json({ error: 'WALLET_CHALLENGE_NOT_CONFIGURED' })
  if (!config) throw new ServiceUnavailableError('WALLET_CHALLENGE_NOT_CONFIGURED', { code: 'wallet_challenge_not_configured' })
  if (!stellarUtils?.verifyStellarEd25519) {
    throw new ServiceUnavailableError('WALLET_SIGNATURE_VERIFIER_UNAVAILABLE', { code: 'wallet_signature_verifier_unavailable' })
  }

  try {
    if (!await isSingleSignerAccount(address, config.network)) {
      throw new ValidationError('UNSUPPORTED_STELLAR_ACCOUNT_TYPE', { code: 'unsupported_stellar_account_type' })
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err
    logger.error('auth.wallet_challenge.account_lookup_failed')
    throw new ServiceUnavailableError('STELLAR_ACCOUNT_LOOKUP_FAILED', { code: 'stellar_account_lookup_failed' })
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
}

export async function verifyWalletChallengeHandler(
  req: AuthenticatedRequest & { body: { challengeId?: unknown; signature?: unknown; is_primary?: unknown } },
  res: Response
): Promise<Response> {
  const { uid } = req.user!
  const { challengeId, signature, is_primary = false } = req.body
  if (typeof challengeId !== 'string' || !challengeId || typeof signature !== 'string' || !/^[a-fA-F0-9]{128}$/.test(signature)) {
    throw new ValidationError('INVALID_WALLET_CHALLENGE_REQUEST', { code: 'invalid_wallet_challenge_request' })
  }
  if (typeof is_primary !== 'boolean') return res.status(400).json({ error: 'INVALID_IS_PRIMARY' })
  if (typeof is_primary !== 'boolean') throw new ValidationError('INVALID_IS_PRIMARY', { code: 'invalid_is_primary' })
  if (!stellarUtils?.verifyStellarEd25519) throw new ServiceUnavailableError('WALLET_SIGNATURE_VERIFIER_UNAVAILABLE', { code: 'wallet_signature_verifier_unavailable' })
  const verifySignature = stellarUtils.verifyStellarEd25519.bind(stellarUtils)
  const config = getWalletConfig()
  if (!config) throw new ServiceUnavailableError('WALLET_CHALLENGE_NOT_CONFIGURED', { code: 'wallet_challenge_not_configured' })

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
        throw new ConflictError('WALLET_CHALLENGE_ALREADY_USED_OR_UNKNOWN', { code: 'wallet_challenge_already_used_or_unknown' })
      case 'user-mismatch':
        throw new AuthError('WALLET_CHALLENGE_USER_MISMATCH', { code: 'wallet_challenge_user_mismatch' })
      case 'expired':
        throw new AuthError('WALLET_CHALLENGE_EXPIRED', { code: 'wallet_challenge_expired' })
      case 'context-mismatch':
        throw new AuthError('WALLET_CHALLENGE_CONTEXT_MISMATCH', { code: 'wallet_challenge_context_mismatch' })
      case 'invalid-signature':
        throw new AuthError('INVALID_WALLET_SIGNATURE', { code: 'invalid_wallet_signature' })
      case 'already-registered':
        throw new ConflictError('WALLET_ALREADY_REGISTERED', { code: 'wallet_already_registered' })
      case 'verified':
        return res.status(200).json({ success: true, wallet_address: result.address })
    }
  } catch (error: unknown) {
    const code = (error as { code?: string }).code
    if (code === '23505') throw new ConflictError('WALLET_ALREADY_REGISTERED', { code: 'wallet_already_registered' })
    throw error
  }
}
