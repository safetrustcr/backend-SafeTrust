/**
 * @file src/services/escrow-verification.ts
 * @description Centralized escrow verification service for SafeTrust bookings.
 *              Validates caller, roles, amounts (in exact stroops), asset, network,
 *              and booking state during escrow initialization and reconciliation.
 */

import { amountToStroops } from '../lib/stellar-amounts'
import { getStellarConfig } from '../config/stellar'
import { query, withTransaction } from './db'
import type { PoolClient } from 'pg'

export interface EscrowVerificationTarget {
  id?: string
  contract_id?: string
  contractId?: string
  marker?: string
  approver?: string
  releaser?: string
  resolver?: string | null
  receiver?: string | null
  platformAddress?: string | null
  releaseSigner?: string | null
  disputeResolver?: string | null
  amount?: number | string
  asset_code?: string
  assetCode?: string
  asset_issuer?: string | null
  assetIssuer?: string | null
  token_contract_id?: string | null
  tokenContractId?: string | null
  reservation_id?: string | null
  booking_metadata?: { reservation_id?: string; [key: string]: unknown } | null
  engagementId?: string | null
}

export interface ReservationVerificationTarget {
  id: string
  status: string
  total_amount: number | string
  asset_code?: string
  guest_id: string
  owner_id?: string
  escrow_id?: string | null
  guest_wallet?: string | null
  host_wallet?: string | null
}

export interface VerificationContext {
  callerUserId?: string
  isServerAgent?: boolean
  phase?: 'initialization' | 'transition' | 'reconciliation' | 'audit'
}

export interface EscrowVerificationResult {
  valid: boolean
  mismatches: string[]
}

export interface EscrowVerificationEventParams {
  escrowId?: string | null
  reservationId?: string | null
  contractId?: string | null
  result: 'valid' | 'mismatch' | 'untrusted'
  mismatches?: string[]
  tenantId?: string
}

/**
 * Normalizes a Stellar address or identifier for comparison.
 */
function normalizeAddress(addr?: string | null): string {
  return (addr ?? '').trim()
}

/**
 * Verifies that an escrow matches the booking requirements.
 * Returns { valid: true, mismatches: [] } or a list of specific mismatch descriptions.
 */
export function verifyEscrowForReservation(
  escrow: EscrowVerificationTarget,
  reservation: ReservationVerificationTarget,
  context?: VerificationContext
): EscrowVerificationResult {
  const mismatches: string[] = []
  const config = getStellarConfig()
  const phase = context?.phase ?? 'initialization'

  // 1. Reservation State: phase-specific
  const escrowIdentifier = escrow.contract_id || escrow.contractId
  const escrowDbId = (escrow as { id?: string }).id
  const isSameLinkRetry =
    reservation.status === 'escrow_created' &&
    Boolean(reservation.escrow_id) &&
    (reservation.escrow_id === escrowIdentifier ||
      (escrowDbId !== undefined && reservation.escrow_id === escrowDbId))

  if (phase === 'initialization') {
    if (reservation.status !== 'pending' && !isSameLinkRetry) {
      mismatches.push(
        `Reservation state invalid: expected "pending" (or retry with "escrow_created" matching current escrow), observed "${reservation.status}"`
      )
    }
  } else {
    const validLifecycleStatuses = [
      'pending',
      'escrow_created',
      'funded',
      'checked_in',
      'checked_out',
      'completed',
      'disputed',
      'resolved',
    ]
    if (!validLifecycleStatuses.includes(reservation.status)) {
      mismatches.push(
        `Reservation state invalid for ${phase}: observed "${reservation.status}"`
      )
    }
  }

  // 2. Reservation Escrow Link
  if (reservation.escrow_id) {
    const isIdempotent =
      reservation.escrow_id === escrowIdentifier ||
      (escrowDbId !== undefined && reservation.escrow_id === escrowDbId)
    if (!isIdempotent) {
      mismatches.push(
        `Reservation already linked to a different escrow: ${reservation.escrow_id}`
      )
    }
  } else if (phase !== 'initialization') {
    mismatches.push(`Reservation ${reservation.id} is not linked to any escrow`)
  }

  // 3. Caller Authorization (Guest or Authorized Server Agent)
  if (context?.callerUserId && !context.isServerAgent) {
    if (context.callerUserId !== reservation.guest_id) {
      mismatches.push(
        `Caller ${context.callerUserId} is not the reservation guest ${reservation.guest_id}`
      )
    }
  }

  // 4. Engagement / Reservation ID matching
  const engagementId =
    escrow.engagementId ||
    escrow.reservation_id ||
    escrow.booking_metadata?.reservation_id ||
    (escrow as any).raw?.engagementId
  if (!engagementId) {
    mismatches.push('Escrow missing engagement evidence: reservation identifier is required')
  } else if (engagementId !== reservation.id) {
    mismatches.push(
      `Escrow engagement ID mismatch: expected ${reservation.id}, observed ${engagementId}`
    )
  }

  // 5. Asset Code & Network Assets
  const escrowAsset = (escrow.asset_code || escrow.assetCode || '').toUpperCase()
  if (escrowAsset !== 'USDC') {
    mismatches.push(`Escrow asset invalid: expected "USDC", observed "${escrowAsset || 'missing'}"`)
  }

  const escrowIssuer = escrow.asset_issuer || escrow.assetIssuer
  const escrowTokenContract = escrow.token_contract_id || escrow.tokenContractId

  if (!escrowIssuer && !escrowTokenContract) {
    mismatches.push(
      'Missing USDC identity evidence: escrow must specify either asset issuer or token contract ID'
    )
  }

  if (escrowIssuer && normalizeAddress(escrowIssuer) !== normalizeAddress(config.usdcIssuer)) {
    mismatches.push(
      `Escrow asset issuer mismatch: expected ${config.usdcIssuer}, observed ${escrowIssuer}`
    )
  }

  if (
    escrowTokenContract &&
    normalizeAddress(escrowTokenContract) !== normalizeAddress(config.usdcContractId)
  ) {
    mismatches.push(
      `Escrow token contract mismatch: expected ${config.usdcContractId}, observed ${escrowTokenContract}`
    )
  }

  // 6. Deposit Amount Matching (Exact integer stroops)
  const escrowStroops =
    escrow.amount !== undefined && escrow.amount !== null
      ? amountToStroops(escrow.amount)
      : null
  const reservationStroops =
    reservation.total_amount !== undefined && reservation.total_amount !== null
      ? amountToStroops(reservation.total_amount)
      : null

  if (escrowStroops === null || reservationStroops === null) {
    mismatches.push(
      `Invalid amount precision: escrow=${escrow.amount}, reservation=${reservation.total_amount}`
    )
  } else if (escrowStroops !== reservationStroops) {
    mismatches.push(
      `Escrow amount mismatch: escrow is ${escrowStroops} stroops, reservation requires ${reservationStroops} stroops`
    )
  }

  // 7. Role Verification
  // Approver must match Guest's verified Stellar wallet
  if (!reservation.guest_wallet) {
    mismatches.push('Reservation is missing verified guest Stellar wallet')
  }
  if (!escrow.approver) {
    mismatches.push('Escrow is missing approver role')
  } else if (
    reservation.guest_wallet &&
    normalizeAddress(escrow.approver) !== normalizeAddress(reservation.guest_wallet)
  ) {
    mismatches.push(
      `Escrow approver role mismatch: expected guest wallet ${reservation.guest_wallet}, observed ${escrow.approver}`
    )
  }

  // Receiver / Marker must match Host's verified Stellar wallet
  const hostTarget = escrow.receiver || escrow.marker
  if (!reservation.host_wallet) {
    mismatches.push('Reservation is missing verified host Stellar wallet')
  }
  if (!hostTarget) {
    mismatches.push('Escrow is missing receiver/marker role')
  } else if (
    reservation.host_wallet &&
    normalizeAddress(hostTarget) !== normalizeAddress(reservation.host_wallet)
  ) {
    mismatches.push(
      `Escrow receiver/marker role mismatch: expected host wallet ${reservation.host_wallet}, observed ${hostTarget}`
    )
  }

  // SafeTrust Platform Roles
  const platformRole = escrow.platformAddress || escrow.releaser
  if (config.platformWallet) {
    if (!platformRole) {
      mismatches.push('Escrow is missing required platform address/role')
    } else if (normalizeAddress(platformRole) !== normalizeAddress(config.platformWallet)) {
      mismatches.push(
        `Platform address mismatch: expected ${config.platformWallet}, observed ${platformRole}`
      )
    }
  }

  const releaserRole = escrow.releaseSigner || escrow.releaser
  const expectedReleaser = config.releaseSigner || config.platformWallet
  if (expectedReleaser) {
    if (!releaserRole) {
      mismatches.push('Escrow is missing required release signer role')
    } else if (normalizeAddress(releaserRole) !== normalizeAddress(expectedReleaser)) {
      mismatches.push(
        `Release signer mismatch: expected ${expectedReleaser}, observed ${releaserRole}`
      )
    }
  }

  const resolverRole = escrow.disputeResolver || escrow.resolver
  if (resolverRole && config.disputeResolver) {
    if (normalizeAddress(resolverRole) !== normalizeAddress(config.disputeResolver)) {
      mismatches.push(
        `Dispute resolver mismatch: expected ${config.disputeResolver}, observed ${resolverRole}`
      )
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  }
}

/**
 * Queries database for reservation details, apartment host, and verified Stellar wallets.
 */
export async function getReservationVerificationData(
  reservationId: string,
  client?: PoolClient
): Promise<ReservationVerificationTarget | null> {
  const sql = `
    SELECT
      r.id,
      r.status,
      r.total_amount,
      r.asset_code,
      r.guest_id,
      r.escrow_id,
      a.owner_id,
      gw.wallet_address AS guest_wallet,
      hw.wallet_address AS host_wallet
    FROM safetrust.reservations r
    JOIN safetrust.apartments a ON a.id = r.apartment_id
    LEFT JOIN safetrust.user_wallets gw
      ON gw.user_id = r.guest_id
      AND gw.chain_type = 'STELLAR'
      AND gw.is_primary = true
    LEFT JOIN safetrust.user_wallets hw
      ON hw.user_id = a.owner_id
      AND hw.chain_type = 'STELLAR'
      AND hw.is_primary = true
    WHERE r.id = $1
    LIMIT 1
  `

  const res = client
    ? await client.query(sql, [reservationId])
    : await query<any>(sql, [reservationId])

  if (!res?.rows || res.rows.length === 0) {
    return null
  }

  const row = res.rows[0]
  return {
    id: row.id,
    status: row.status,
    total_amount: row.total_amount,
    asset_code: row.asset_code,
    guest_id: row.guest_id,
    owner_id: row.owner_id,
    escrow_id: row.escrow_id,
    guest_wallet: row.guest_wallet ?? null,
    host_wallet: row.host_wallet ?? null,
  }
}

/**
 * Records an escrow verification event into the audit table.
 */
export async function recordEscrowVerificationEvent(
  params: EscrowVerificationEventParams,
  client?: PoolClient
): Promise<void> {
  const sql = `
    INSERT INTO safetrust.escrow_verification_events (
      escrow_id,
      reservation_id,
      contract_id,
      result,
      mismatches,
      tenant_id,
      checked_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, NOW()
    )
  `
  const values = [
    params.escrowId ?? null,
    params.reservationId ?? null,
    params.contractId ?? null,
    params.result,
    JSON.stringify(params.mismatches ?? []),
    params.tenantId ?? 'safetrust',
  ]

  try {
    if (client) {
      await client.query(sql, values)
    } else {
      await query(sql, values)
    }
  } catch (err) {
    // If table doesn't exist yet (e.g. before migration), log error but don't break flow
    console.error('[escrow-verification] Failed to record verification audit event:', err)
  }
}

/**
 * Atomically marks an escrow untrusted and records the verification event.
 */
export async function markEscrowUntrusted(
  contractId: string,
  reason: string,
  tenantId: string = 'safetrust'
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE safetrust.trustless_work_escrows
       SET status = 'untrusted', updated_at = NOW()
       WHERE contract_id = $1 AND tenant_id = $2`,
      [contractId, tenantId]
    )

    await recordEscrowVerificationEvent(
      {
        contractId,
        result: 'untrusted',
        mismatches: [reason],
        tenantId,
      },
      client
    )
  })
}
