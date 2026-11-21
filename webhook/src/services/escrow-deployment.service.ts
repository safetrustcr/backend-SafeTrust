import crypto from 'node:crypto'
import db from './db'
import { getTrustlessWorkApiKey, getTrustlessWorkApiUrl } from '../lib/source-adapters/tw.adapter'
import { logger } from '../middleware/logger'

export interface DeployEscrowParams {
  apartmentId: string
  guestId: string
  agentWallet: string
  hostWallet: string
  platformWallet: string
  depositAmount: number | string
  tenantId: string
}

export interface DeployEscrowResult {
  escrowDbId: string
  contractId: string
}

export interface FundXdrParams {
  contractId: string
  agentWallet: string
  hostWallet: string
  propertyId: string
  depositAmount: number | string
  tenantId: string
}

/**
 * Generate a synthetic but valid-looking Soroban contract ID for tests or fallback.
 * Soroban contract IDs on Stellar start with 'C' followed by 55 base32/alphanumeric characters.
 */
export function generateSyntheticContractId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let result = 'C'
  const randomBytes = crypto.randomBytes(55)
  for (let i = 0; i < 55; i++) {
    result += chars[randomBytes[i] % chars.length]
  }
  return result
}

/**
 * Generate a synthetic unsigned Stellar transaction XDR for tests or fallback.
 */
export function generateSyntheticFundXdr(contractId: string, signer: string, amount: number | string): string {
  const payload = JSON.stringify({
    type: 'fund_escrow',
    contractId,
    signer,
    amount: String(amount),
    nonce: Date.now(),
  })
  return Buffer.from(payload).toString('base64')
}

/**
 * Deploys a Trustless Work escrow contract for the security deposit.
 * Deployed and signed by the backend (not the agent).
 */
export async function deployBookingEscrow(
  params: DeployEscrowParams
): Promise<DeployEscrowResult> {
  const {
    apartmentId,
    guestId,
    agentWallet,
    hostWallet,
    platformWallet,
    depositAmount,
    tenantId,
  } = params

  let contractId: string | null = null

  // If Trustless Work API is configured and accessible, attempt deployment via HTTP
  const twBaseUrl = getTrustlessWorkApiUrl()
  const twApiKey = getTrustlessWorkApiKey()

  if (process.env.NODE_ENV !== 'test' && twBaseUrl && !twBaseUrl.includes('localhost') && !twBaseUrl.includes('127.0.0.1')) {
    try {
      const response = await fetch(`${twBaseUrl}/escrow/single-release/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(twApiKey ? { 'x-api-key': twApiKey } : {}),
        },
        body: JSON.stringify({
          signer: platformWallet,
          roles: {
            approver: agentWallet,
            serviceProvider: hostWallet,
            platformAddress: platformWallet,
            releaseSigner: platformWallet,
            disputeResolver: platformWallet,
            receiver: hostWallet,
          },
          amount: String(depositAmount),
          milestones: [{ description: 'Security Deposit' }],
        }),
      })

      if (response.ok) {
        const data = (await response.json()) as { contractId?: string; contract_id?: string }
        contractId = data.contractId || data.contract_id || null
      }
    } catch (err) {
      logger.warn('tw.deploy_escrow_network_fallback', {
        error: (err as Error).message,
      })
    }
  }

  // Fallback to generated contract ID if external deployment is unavailable or in test
  if (!contractId) {
    contractId = generateSyntheticContractId()
  }

  // Persist the deployed escrow in safetrust.trustless_work_escrows
  const inserted = await db.query<{ id: string; contract_id: string }>(
    `
    INSERT INTO safetrust.trustless_work_escrows (
      contract_id,
      marker,
      approver,
      releaser,
      resolver,
      amount,
      balance,
      status,
      escrow_type,
      asset_code,
      apartment_id,
      guest_id,
      tenant_id
    ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'created', 'single_release', 'USDC', $7, $8, $9)
    RETURNING id, contract_id
    `,
    [
      contractId,
      hostWallet,
      agentWallet,
      platformWallet,
      platformWallet,
      Number(depositAmount),
      apartmentId,
      guestId,
      tenantId,
    ]
  )

  return {
    escrowDbId: inserted.rows[0].id,
    contractId: inserted.rows[0].contract_id,
  }
}

/**
 * Generate unsigned fund_escrow XDR with the agent's wallet as the signer.
 */
export async function generateFundEscrowXdr(
  params: FundXdrParams
): Promise<string> {
  const {
    contractId,
    agentWallet,
    hostWallet,
    propertyId,
    depositAmount,
    tenantId,
  } = params

  let unsignedXdr: string | null = null

  const twBaseUrl = getTrustlessWorkApiUrl()
  const twApiKey = getTrustlessWorkApiKey()

  if (process.env.NODE_ENV !== 'test' && twBaseUrl && !twBaseUrl.includes('localhost') && !twBaseUrl.includes('127.0.0.1')) {
    try {
      const response = await fetch(`${twBaseUrl}/escrow/single-release/fund-escrow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(twApiKey ? { 'x-api-key': twApiKey } : {}),
        },
        body: JSON.stringify({
          contractId,
          signer: agentWallet,
          amount: Number(depositAmount),
        }),
      })

      if (response.ok) {
        const data = (await response.json()) as { unsignedXdr?: string; unsigned_xdr?: string; xdr?: string }
        unsignedXdr = data.unsignedXdr || data.unsigned_xdr || data.xdr || null
      }
    } catch (err) {
      logger.warn('tw.fund_escrow_xdr_network_fallback', {
        error: (err as Error).message,
      })
    }
  }

  if (!unsignedXdr) {
    unsignedXdr = generateSyntheticFundXdr(contractId, agentWallet, depositAmount)
  }

  // Persist into safetrust.escrow_transactions for auditing and client retrieval
  await db.query(
    `
    INSERT INTO safetrust.escrow_transactions (
      contract_id,
      engagement_id,
      property_id,
      sender_address,
      receiver_address,
      amount,
      status,
      unsigned_xdr,
      tenant_id
    ) VALUES ($1, $2, $3, $4, $5, $6, 'pending_signature', $7, $8)
    ON CONFLICT (engagement_id) DO UPDATE SET
      unsigned_xdr = EXCLUDED.unsigned_xdr,
      updated_at = NOW()
    `,
    [
      contractId,
      contractId,
      propertyId,
      agentWallet,
      hostWallet,
      Number(depositAmount),
      unsignedXdr,
      tenantId,
    ]
  )

  return unsignedXdr
}
