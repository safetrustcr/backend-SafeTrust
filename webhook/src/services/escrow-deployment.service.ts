import crypto from 'node:crypto'
import db from './db'
import { getTrustlessWorkApiKey, getTrustlessWorkApiUrl } from '../lib/source-adapters/tw.adapter'
import { logger } from '../middleware/logger'
import { ServiceUnavailableError } from '../utils/errors'

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
 * Generate a synthetic but valid-looking Soroban contract ID. Only used in
 * tests: a real booking must never link an ID Trustless Work did not deploy.
 */
export function generateSyntheticContractId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let result = 'C'
  for (let i = 0; i < 55; i++) {
    // `randomInt` samples the range without the modulo bias CodeQL reports for
    // `randomBytes(...) % chars.length`.
    result += chars[crypto.randomInt(chars.length)]
  }
  return result
}

/**
 * Generate a synthetic unsigned Stellar transaction XDR. Tests only, for the
 * same reason as generateSyntheticContractId.
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

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test'
}

/**
 * Trustless Work is only used when a real (non-local) base URL is configured.
 */
function trustedWorkConfig(): { baseUrl: string | null; apiKey: string | null } {
  const baseUrl = getTrustlessWorkApiUrl()
  const usable =
    Boolean(baseUrl) &&
    !baseUrl.includes('localhost') &&
    !baseUrl.includes('127.0.0.1')
  return { baseUrl: usable ? baseUrl : null, apiKey: getTrustlessWorkApiKey() }
}

/**
 * Deploys a Trustless Work escrow contract for the security deposit.
 * Deployed and signed by the backend (not the agent).
 *
 * A contract ID is only returned once Trustless Work confirms the deployment.
 * When the API answers with an unsigned init transaction instead of a contract
 * ID, the backend cannot sign and submit it here, so the call fails with a
 * retryable error rather than linking an ID that does not exist on-chain.
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

  const { baseUrl, apiKey } = trustedWorkConfig()
  let contractId: string | null = null

  if (isTestEnv() || !baseUrl) {
    if (!isTestEnv()) {
      throw new ServiceUnavailableError(
        'Trustless Work escrow deployment is not configured'
      )
    }
    // Synthetic IDs are confined to tests, where no on-chain contract exists.
    contractId = generateSyntheticContractId()
  } else {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/escrow/single-release/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          signer: platformWallet,
          roles: {
            approver: agentWallet,
            // The owner receives the released deposit.
            receiver: hostWallet,
            serviceProvider: hostWallet,
            platformAddress: platformWallet,
            releaseSigner: platformWallet,
            disputeResolver: platformWallet,
          },
          amount: String(depositAmount),
          milestones: [{ description: 'Security Deposit' }],
        }),
      })
    } catch (err) {
      logger.warn('tw.deploy_escrow_network_error', {
        error: (err as Error).message,
      })
      throw new ServiceUnavailableError(
        'Trustless Work escrow deployment is unavailable'
      )
    }

    if (!response.ok) {
      logger.warn('tw.deploy_escrow_rejected', { status: response.status })
      throw new ServiceUnavailableError(
        `Trustless Work escrow deployment failed (status ${response.status})`
      )
    }

    const data = (await response.json()) as {
      contractId?: string
      contract_id?: string
      unsignedTransaction?: string
      unsignedXdr?: string
    }
    contractId = data.contractId ?? data.contract_id ?? null

    if (!contractId) {
      // Deployment answered with an init transaction that still has to be
      // signed and submitted. Nothing is on-chain yet, so no contract ID may
      // be linked; the caller retries later without charging again.
      logger.warn('tw.deploy_escrow_unconfirmed', {
        hasInitTransaction: Boolean(data.unsignedTransaction ?? data.unsignedXdr),
      })
      throw new ServiceUnavailableError(
        'Trustless Work did not confirm escrow deployment'
      )
    }
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
 *
 * The funding XDR is the Trustless Work response's `unsignedTransaction`. When
 * the API does not return one, the call fails with a retryable error: handing
 * back synthetic bytes would tell the client a 201 it cannot sign.
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
  const { baseUrl, apiKey } = trustedWorkConfig()

  if (isTestEnv() || !baseUrl) {
    if (!isTestEnv()) {
      throw new ServiceUnavailableError(
        'Trustless Work funding transaction is not configured'
      )
    }
    unsignedXdr = generateSyntheticFundXdr(contractId, agentWallet, depositAmount)
  } else {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/escrow/single-release/fund-escrow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          contractId,
          signer: agentWallet,
          amount: Number(depositAmount),
        }),
      })
    } catch (err) {
      logger.warn('tw.fund_escrow_xdr_network_error', {
        error: (err as Error).message,
      })
      throw new ServiceUnavailableError(
        'Trustless Work funding transaction is unavailable'
      )
    }

    if (!response.ok) {
      logger.warn('tw.fund_escrow_xdr_rejected', { status: response.status })
      throw new ServiceUnavailableError(
        `Trustless Work funding transaction failed (status ${response.status})`
      )
    }

    const data = (await response.json()) as {
      unsignedTransaction?: string
      unsignedXdr?: string
      unsigned_xdr?: string
      xdr?: string
    }
    unsignedXdr =
      data.unsignedTransaction ?? data.unsignedXdr ?? data.unsigned_xdr ?? data.xdr ?? null

    if (!unsignedXdr) {
      logger.warn('tw.fund_escrow_xdr_missing')
      throw new ServiceUnavailableError(
        'Trustless Work did not return a funding transaction'
      )
    }
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
