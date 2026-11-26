import type { PoolClient } from 'pg'
import { query, withTransaction } from '../services/db'
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from '../utils/errors'
import { calculateQuote } from '../services/quote'
import { hasSorobanReconciler, querySorobanEscrow } from '../lib/source-adapters/soroban.adapter'
import { logger } from '../middleware/logger'

export const HOLD_DURATION_MS = 10 * 60 * 1000
export const MAX_ACTIVE_HOLDS_PER_USER = 3
/** pending_payment holds older than this never got their payment confirmed. */
export const PENDING_PAYMENT_TIMEOUT_MS = 2 * 60 * 1000

const EXCLUSION_VIOLATION = '23P01'

export interface HoldRow {
  id: string
  tenant_id: string
  apartment_id: string
  user_id: string
  check_in: Date
  check_out: Date
  guests: number
  status: 'pending_payment' | 'active' | 'converted' | 'released' | 'expired'
  quote_total: string
  quote_deposit: string
  asset_code: string
  payer_address: string | null
  expires_at: Date
}

export interface CreateHoldInput {
  tenantId: string
  userId: string
  apartmentId: string
  checkIn: string
  checkOut: string
  guests: number
  payerAddress?: string | null
}

/**
 * SQL fragment (for use inside a WHERE) that is true when `apartmentAlias` has
 * a live hold overlapping [checkIn, checkOut). Search and availability checks
 * must treat such apartments as unavailable.
 */
export function liveHoldOverlapSql(
  apartmentAlias: string,
  checkInParam: string,
  checkOutParam: string
): string {
  return `EXISTS (
    SELECT 1 FROM safetrust.booking_holds h
    WHERE h.apartment_id = ${apartmentAlias}.id
      AND h.status IN ('pending_payment', 'active')
      AND h.expires_at > NOW()
      AND tstzrange(h.check_in, h.check_out, '[)') && tstzrange(${checkInParam}::timestamptz, ${checkOutParam}::timestamptz, '[)')
  )`
}

/**
 * Create a hold in `pending_payment`. One transaction: lock the apartment row,
 * expire lapsed holds, enforce the per-user cap, check reservations, insert.
 * Overlap with another hold is rejected by the exclusion constraint.
 */
export async function createHold(input: CreateHoldInput): Promise<HoldRow & { price_total: string }> {
  return withTransaction(async (client: PoolClient) => {
    const apt = await client.query<{
      id: string
      price: string
      warranty_deposit: string
      max_guests: number | null
      is_available: boolean | null
    }>(
      `SELECT id, price, warranty_deposit, max_guests, is_available
         FROM safetrust.apartments
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [input.apartmentId]
    )
    const apartment = apt.rows[0]
    if (!apartment) throw new NotFoundError('Property not found')
    if (apartment.is_available === false) {
      throw new ConflictError('Property is not available', { code: 'not_available' })
    }
    if (apartment.max_guests != null && input.guests > apartment.max_guests) {
      throw new ValidationError(`Property sleeps at most ${apartment.max_guests} guests`)
    }

    // The exclusion predicate cannot use now(), so lapsed holds are expired here.
    await client.query(
      `UPDATE safetrust.booking_holds
          SET status = 'expired', updated_at = NOW()
        WHERE apartment_id = $1
          AND status IN ('pending_payment', 'active')
          AND expires_at <= NOW()`,
      [input.apartmentId]
    )

    // Serialize the per-user limit: concurrent holds on different apartments
    // would otherwise both count the same live holds and both insert.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `booking_holds:${input.tenantId}:${input.userId}`,
    ])
    const live = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM safetrust.booking_holds
        WHERE user_id = $1 AND tenant_id = $2
          AND status IN ('pending_payment', 'active') AND expires_at > NOW()`,
      [input.userId, input.tenantId]
    )
    if (Number(live.rows[0].n) >= MAX_ACTIVE_HOLDS_PER_USER) {
      throw new ConflictError(
        `At most ${MAX_ACTIVE_HOLDS_PER_USER} active holds per user`,
        { code: 'hold_limit_reached' }
      )
    }

    const booked = await client.query(
      `SELECT 1 FROM safetrust.reservations
        WHERE apartment_id = $1
          AND status NOT IN ('cancelled', 'resolved')
          AND tstzrange(check_in_date, check_out_date, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
        LIMIT 1`,
      [input.apartmentId, input.checkIn, input.checkOut]
    )
    if (booked.rows.length > 0) {
      throw new ConflictError('Dates are not available', { code: 'dates_unavailable' })
    }

    const quote = calculateQuote(apartment, input.checkIn, input.checkOut)
    const priceTotal = quote.total

    try {
      const inserted = await client.query<HoldRow>(
        `INSERT INTO safetrust.booking_holds
           (tenant_id, apartment_id, user_id, check_in, check_out, guests, status,
            quote_total, quote_deposit, payer_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending_payment', $7, $8, $9, NOW() + ($10 || ' milliseconds')::interval)
         RETURNING *`,
        [
          input.tenantId,
          input.apartmentId,
          input.userId,
          input.checkIn,
          input.checkOut,
          input.guests,
          priceTotal,
          apartment.warranty_deposit,
          input.payerAddress ?? null,
          String(HOLD_DURATION_MS),
        ]
      )
      return { ...inserted.rows[0], price_total: priceTotal }
    } catch (error) {
      if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
        throw new ConflictError('Dates are not available', { code: 'dates_unavailable' })
      }
      throw error
    }
  })
}

/** Mark a pending_payment hold active once its x402 payment is confirmed. */
export async function activateHold(holdId: string): Promise<boolean> {
  const result = await query(
    `UPDATE safetrust.booking_holds
        SET status = 'active', updated_at = NOW()
      WHERE id = $1 AND status = 'pending_payment' AND expires_at > NOW()`,
    [holdId]
  )
  return (result.rowCount ?? 0) > 0
}

/** Load a hold for a tenant, with the fields a paid retry validates. */
export async function findHoldById(
  holdId: string,
  tenantId: string
): Promise<HoldRow | undefined> {
  const found = await query<HoldRow>(
    `SELECT id, tenant_id, apartment_id, user_id, check_in, check_out, guests, status,
            quote_total, quote_deposit, asset_code, payer_address, expires_at
       FROM safetrust.booking_holds
      WHERE id = $1 AND tenant_id = $2`,
    [holdId, tenantId]
  )
  return found.rows[0]
}

/** Release a hold whose payment failed. The fee, if any, is not refunded. */
export async function releasePendingHold(holdId: string): Promise<void> {
  await query(
    `UPDATE safetrust.booking_holds
        SET status = 'released', updated_at = NOW()
      WHERE id = $1 AND status = 'pending_payment'`,
    [holdId]
  )
}

/** Release the caller's own hold. 404 if missing, 403 if it is someone else's. */
export async function releaseHold(holdId: string, userId: string, tenantId: string): Promise<void> {
  const found = await query<{ user_id: string; status: string }>(
    `SELECT user_id, status FROM safetrust.booking_holds WHERE id = $1 AND tenant_id = $2`,
    [holdId, tenantId]
  )
  const hold = found.rows[0]
  if (!hold) throw new NotFoundError('Hold not found')
  if (hold.user_id !== userId) throw new ForbiddenError('Not your hold')
  if (hold.status !== 'active' && hold.status !== 'pending_payment') {
    throw new ConflictError(`Hold is already ${hold.status}`, { code: 'hold_not_live' })
  }
  const released = await query(
    `UPDATE safetrust.booking_holds
        SET status = 'released', updated_at = NOW()
      WHERE id = $1 AND status IN ('pending_payment', 'active')`,
    [holdId]
  )
  if ((released.rowCount ?? 0) === 0) {
    throw new ConflictError('Hold is no longer live', { code: 'hold_not_live' })
  }
}

export type EscrowFundingState = 'funded' | 'unfunded' | 'unknown'

export interface EscrowFundingTarget {
  contractId: string | null
  network: string | null
}

/** Live on-chain funding check used before an unfunded reservation is cancelled. */
export type EscrowFundingChecker = (
  target: EscrowFundingTarget
) => Promise<EscrowFundingState>

const DEFAULT_STELLAR_NETWORK = 'testnet'

/**
 * Default on-chain funding check, backed by the same soroban-reconciler native
 * addon the reconciliation service uses (`querySorobanEscrow`).
 *
 * Returns `unknown` whenever the live state cannot be read (addon missing, RPC
 * or network error, malformed payload) so the caller treats it as unverifiable
 * and preserves the reservation instead of risking a funded deposit.
 */
export const checkEscrowFundingOnChain: EscrowFundingChecker = async ({
  contractId,
  network,
}) => {
  // No contract was ever linked, so there is nothing on-chain to protect.
  if (!contractId) return 'unfunded'

  if (!hasSorobanReconciler()) {
    logger.warn('hold.onchain_funding_check_unavailable', { contractId })
    return 'unknown'
  }

  try {
    const raw = querySorobanEscrow(contractId, network || DEFAULT_STELLAR_NETWORK)
    const onChain = JSON.parse(raw) as {
      status?: string
      balance?: number | string | null
    }
    const balance = Number(onChain?.balance ?? 0)
    if (
      onChain?.status === 'funded' ||
      onChain?.status === 'completed' ||
      (Number.isFinite(balance) && balance > 0)
    ) {
      return 'funded'
    }
    return 'unfunded'
  } catch (error) {
    logger.warn('hold.onchain_funding_check_failed', {
      contractId,
      error: (error as Error).message,
    })
    return 'unknown'
  }
}

let escrowFundingChecker: EscrowFundingChecker = checkEscrowFundingOnChain

/** Test seam: install a checker, or pass null to restore the on-chain default. */
export function setEscrowFundingChecker(checker: EscrowFundingChecker | null): void {
  escrowFundingChecker = checker ?? checkEscrowFundingOnChain
}

export interface UnfundedReservationCandidate {
  reservation_id: string
  contract_id: string | null
  network: string | null
  escrow_status: string | null
}

interface LockedReservation {
  reservation_id: string
  reservation_status: string
  escrow_id: string | null
}

interface LockedEscrow {
  contract_id: string | null
  network: string | null
  status: string | null
}

/**
 * Cancel reservations created from a hold whose deposit escrow was never
 * funded, as soon as the hold deadline passes.
 *
 * The reservation stays `escrow_created` while the agent signs and submits the
 * fund transaction; if it never does, cancelling frees the dates for others.
 *
 * Before cancelling, the escrow's live on-chain funding state is verified with
 * `escrowFundingChecker`. A reservation is preserved when its escrow is funded
 * (or completed) in the database, when the on-chain balance is non-zero, or
 * when the live check cannot establish the state (RPC/network error). Funded
 * deposits are therefore never cancelled or double-booked by the sweep.
 *
 * Each candidate is cancelled in its own transaction that holds
 * `FOR NO KEY UPDATE` locks on the reservation and its escrow, re-checks both
 * statuses under the lock, and then re-confirms the on-chain state. A funding
 * update that commits before those locks are taken is therefore observed and
 * wins; one that arrives later waits for the sweep to commit and then sees the
 * cancelled reservation.
 */
export async function cancelUnfundedReservationsForExpiredHolds(): Promise<number> {
  const candidates = await query<UnfundedReservationCandidate>(
    `SELECT r.id::text AS reservation_id,
            e.contract_id,
            e.network,
            e.status AS escrow_status
       FROM safetrust.reservations r
       JOIN safetrust.booking_holds h ON h.id = r.booking_hold_id
       LEFT JOIN safetrust.trustless_work_escrows e ON e.id = r.escrow_id
      WHERE r.status = 'escrow_created'
        AND h.expires_at <= NOW()`
  )

  let cancelled = 0
  for (const candidate of candidates.rows) {
    // Cheap early exit; the authoritative check happens again under the lock.
    if (candidate.escrow_status === 'funded' || candidate.escrow_status === 'completed') {
      continue
    }

    const didCancel = await withTransaction(async (client: PoolClient) => {
      // Lock the reservation row before its escrow row: any concurrent escrow
      // funding update either landed before this lock or waits for the commit.
      const lockedReservation = await client.query<LockedReservation>(
        `SELECT r.id::text AS reservation_id,
                r.status AS reservation_status,
                r.escrow_id::text AS escrow_id
           FROM safetrust.reservations r
          WHERE r.id = $1
            AND r.status = 'escrow_created'
            AND EXISTS (
              SELECT 1
                FROM safetrust.booking_holds h
               WHERE h.id = r.booking_hold_id
                 AND h.expires_at <= NOW()
            )
          FOR NO KEY UPDATE OF r`,
        [candidate.reservation_id]
      )
      const reservation = lockedReservation.rows[0]
      if (!reservation || reservation.reservation_status !== 'escrow_created') {
        return false
      }

      let escrow: LockedEscrow | undefined
      if (reservation.escrow_id) {
        const lockedEscrow = await client.query<LockedEscrow>(
          `SELECT contract_id, network, status
             FROM safetrust.trustless_work_escrows
            WHERE id = $1
            FOR NO KEY UPDATE`,
          [reservation.escrow_id]
        )
        escrow = lockedEscrow.rows[0]
      }

      // An escrow funded or completed while this candidate waited for the lock
      // must win over the sweep.
      if (escrow?.status === 'funded' || escrow?.status === 'completed') {
        return false
      }

      let fundingState: EscrowFundingState
      try {
        fundingState = await escrowFundingChecker({
          contractId: escrow?.contract_id ?? candidate.contract_id,
          network: escrow?.network ?? candidate.network,
        })
      } catch (error) {
        // A transient check failure must not free dates a deposit may hold.
        logger.warn('hold.onchain_funding_check_threw', {
          contractId: candidate.contract_id,
          reservationId: candidate.reservation_id,
          error: (error as Error).message,
        })
        fundingState = 'unknown'
      }

      if (fundingState !== 'unfunded') return false

      const updated = await client.query(
        `UPDATE safetrust.reservations
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = NULL,
                cancel_reason = 'hold_expired',
                updated_at = NOW()
          WHERE id = $1
            AND status = 'escrow_created'`,
        [reservation.reservation_id]
      )
      return (updated.rowCount ?? 0) > 0
    })

    if (didCancel) cancelled += 1
  }

  return cancelled
}

/**
 * Expire holds past expires_at, release pending_payment holds whose payment
 * was never confirmed, and cancel reservations left unfunded by a lapsed hold.
 * Returns the number of holds and reservations changed.
 */
export async function expireHolds(): Promise<number> {
  const cancelled = await cancelUnfundedReservationsForExpiredHolds()
  const expired = await query(
    `UPDATE safetrust.booking_holds
        SET status = 'expired', updated_at = NOW()
      WHERE status IN ('pending_payment', 'active') AND expires_at <= NOW()`
  )
  const stuck = await query(
    `UPDATE safetrust.booking_holds
        SET status = 'released', updated_at = NOW()
      WHERE status = 'pending_payment'
        AND created_at <= NOW() - ($1 || ' milliseconds')::interval`,
    [String(PENDING_PAYMENT_TIMEOUT_MS)]
  )
  return (expired.rowCount ?? 0) + (stuck.rowCount ?? 0) + cancelled
}

export interface ConvertHoldResult {
  reservation_id: string
  booking_hold_id: string
  apartment_id: string
  guest_id: string
  check_in_date: Date
  check_out_date: Date
  total_amount: string
  quote_deposit: string
  asset_code: string
  status: string
}

/**
 * Atomically convert an active booking hold into a reservation.
 * Repeated requests for the same hold return the existing reservation.
 */
export async function convertHoldToReservation(
  holdId: string,
  userId: string,
  tenantId: string
): Promise<ConvertHoldResult> {
  return withTransaction(async (client: PoolClient) => {
    const result = await client.query<{
      id: string
      tenant_id: string
      apartment_id: string
      user_id: string
      check_in: Date
      check_out: Date
      status: string
      quote_total: string
      quote_deposit: string
      asset_code: string
      expires_at: Date
      reservation_id: string | null
      reservation_status: string | null
      is_expired: boolean
    }>(
      `SELECT h.id, h.tenant_id, h.apartment_id, h.user_id,
              h.check_in, h.check_out, h.status,
              h.quote_total, h.quote_deposit, h.asset_code,
              h.expires_at,
              r.id AS reservation_id,
              r.status AS reservation_status,
              (h.expires_at <= clock_timestamp()) AS is_expired
         FROM safetrust.booking_holds h
         LEFT JOIN safetrust.reservations r
           ON r.booking_hold_id = h.id
        WHERE h.id = $1 AND h.tenant_id = $2
        FOR UPDATE OF h`,
      [holdId, tenantId]
    )

    const hold = result.rows[0]
    if (!hold) throw new NotFoundError('Hold not found')
    if (hold.user_id !== userId) {
      throw new ForbiddenError('Not your hold')
    }

    // Idempotency: a converted hold must return its original reservation.
    if (hold.status === 'converted') {
      if (!hold.reservation_id) {
        throw new ConflictError(
          'Hold is converted but its reservation is missing',
          { code: 'hold_reservation_missing' }
        )
      }

      return {
        reservation_id: hold.reservation_id,
        booking_hold_id: hold.id,
        apartment_id: hold.apartment_id,
        guest_id: hold.user_id,
        check_in_date: hold.check_in,
        check_out_date: hold.check_out,
        total_amount: hold.quote_total,
        quote_deposit: hold.quote_deposit,
        asset_code: hold.asset_code,
        status: hold.reservation_status ?? 'pending',
      }
    }

    if (hold.status !== 'active') {
      throw new ConflictError(`Hold is ${hold.status}`, {
        code: 'hold_not_active',
      })
    }

    if (hold.is_expired) {
      throw new ConflictError('Hold has expired', {
        code: 'hold_expired',
      })
    }

    if (Number(hold.quote_total) <= 0) {
      throw new ValidationError('Booking total must be greater than zero')
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO safetrust.reservations
         (apartment_id, guest_id, booking_hold_id,
          check_in_date, check_out_date, total_amount,
          asset_code, status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING id`,
      [
        hold.apartment_id,
        hold.user_id,
        hold.id,
        hold.check_in,
        hold.check_out,
        hold.quote_total,
        hold.asset_code,
        hold.tenant_id,
      ]
    )

    const reservationId = inserted.rows[0].id

    const updated = await client.query(
      `UPDATE safetrust.booking_holds
          SET status = 'converted', updated_at = NOW()
        WHERE id = $1 AND status = 'active'`,
      [hold.id]
    )

    if (updated.rowCount !== 1) {
      throw new ConflictError('Hold could not be converted', {
        code: 'hold_conversion_failed',
      })
    }

    return {
      reservation_id: reservationId,
      booking_hold_id: hold.id,
      apartment_id: hold.apartment_id,
      guest_id: hold.user_id,
      check_in_date: hold.check_in,
      check_out_date: hold.check_out,
      total_amount: hold.quote_total,
      quote_deposit: hold.quote_deposit,
      asset_code: hold.asset_code,
      status: 'pending',
    }
  })
}
