import { PoolClient } from 'pg'
import db, { Queryable, withTransaction } from './db'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../utils/errors'
import { getQuoteForProperty, QuoteResult } from './quote'
import { deployBookingEscrow, generateFundEscrowXdr } from './escrow-deployment.service'
import { processHelperSubmission, StellarNetwork } from './confirmation.service'
import { logger } from '../middleware/logger'

const STELLAR_ADDR_RE = /^[GC][A-Z2-7]{55}$/
const DEFAULT_PLATFORM_WALLET = 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM'

/**
 * Outcome of the booking-fee settlement, returned by `chargeBookingFee`.
 * `reservationId` is set when the settled proof is already bound to a
 * reservation (see `bindSettlementToReservation`).
 */
export interface BookingFeeOutcome {
  reused?: boolean
  reservationId?: string | null
}

export interface CreateBookingParams {
  userId: string
  tenantId: string
  holdId?: string
  propertyId?: string
  checkIn?: string
  checkOut?: string
  guests?: number
  payerWallet?: string | null
  /**
   * Settles the booking fee. Invoked only when a new reservation is about to
   * be created, so retries of an already-converted hold are never charged.
   */
  chargeBookingFee?: () => Promise<BookingFeeOutcome | void>
  /**
   * Records which reservation a settled direct (hold-less) payment proof paid
   * for, so one proof can never authorize a second reservation. Optional only
   * when no fee is charged. Called inside the reservation's transaction with
   * its client, so a failed binding rolls the reservation back.
   */
  bindBookingFeeReservation?: (
    reservationId: string,
    client?: Queryable
  ) => Promise<void>
  /**
   * Resolves, without charging, the reservation an already-settled direct
   * (hold-less) payment proof paid for. Returns null when the proof has not
   * settled yet. Optional only when no fee is charged.
   */
  resolveBookingFeeBinding?: () => Promise<string | null>
}

export interface CreateBookingResult {
  reservation_id: string
  contract_id: string
  deposit: string
  asset: string
  unsigned_xdr: string
  is_existing?: boolean
}

export interface SubmitBookingParams {
  reservationId: string
  userId: string
  tenantId: string
  signedXdr: string
}

export interface SubmitBookingResult {
  success: boolean
  reservation_id: string
  contract_id: string
  tx_hash?: string
  status: string
  stage?: string
  error?: string
  retryRecordId?: string
}

interface BookingWallets {
  agentWallet: string
  hostWallet: string
  platformWallet: string
}

interface HoldRow {
  id: string
  tenant_id: string
  apartment_id: string
  user_id: string
  check_in: Date | string
  check_out: Date | string
  guests: number
  status: string
  expires_at: Date
  is_expired: boolean
  reservation_id: string | null
  reservation_status: string | null
  contract_id: string | null
  unsigned_xdr: string | null
  quote_deposit: string | null
  asset_code: string | null
}

interface ReservationAttemptRow {
  id: string
  apartment_id: string
  guest_id: string
  check_in_date: Date | string
  check_out_date: Date | string
  contract_id: string | null
  unsigned_xdr: string | null
}

/** Normalise a DATE/TIMESTAMPTZ value to a YYYY-MM-DD booking date. */
function toDateOnly(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10)
}

/**
 * Resolve the Stellar wallet address for a user.
 * Prioritizes registered primary STELLAR wallet in user_wallets, then x402 payer, then any registered wallet.
 */
export async function resolveUserStellarWallet(
  userId: string,
  fallbackWallet?: string | null
): Promise<string> {
  const result = await db.query<{ wallet_address: string; is_primary: boolean }>(
    `
    SELECT wallet_address, is_primary
    FROM safetrust.user_wallets
    WHERE user_id = $1 AND chain_type = 'STELLAR'
    ORDER BY is_primary DESC, created_at DESC
    LIMIT 1
    `,
    [userId]
  )

  if (result.rows.length > 0 && STELLAR_ADDR_RE.test(result.rows[0].wallet_address)) {
    return result.rows[0].wallet_address
  }

  if (fallbackWallet && STELLAR_ADDR_RE.test(fallbackWallet)) {
    return fallbackWallet
  }

  // Fallback synthetic wallet for test/agent accounts that haven't explicitly synced a wallet
  return fallbackWallet && fallbackWallet.length > 0
    ? fallbackWallet
    : 'GA' + Buffer.from(userId.padEnd(28, '0')).toString('hex').slice(0, 54)
}

/**
 * Resolve the property owner's Stellar wallet.
 */
export async function resolveOwnerStellarWallet(ownerId: string | undefined): Promise<string> {
  if (!ownerId) {
    throw new ValidationError('Property owner is required for escrow deployment')
  }

  const result = await db.query<{ wallet_address: string }>(
    `
    SELECT wallet_address
    FROM safetrust.user_wallets
    WHERE user_id = $1 AND chain_type = 'STELLAR'
    ORDER BY is_primary DESC, created_at DESC
    LIMIT 1
    `,
    [ownerId]
  )

  if (result.rows.length > 0 && STELLAR_ADDR_RE.test(result.rows[0].wallet_address)) {
    return result.rows[0].wallet_address
  }

  throw new ValidationError('Property owner does not have a valid Stellar wallet')
}

/**
 * Resolve every escrow role up front. Running this before the fee is settled
 * means a guest without a wallet, or a property whose owner has none, fails
 * before any charge or database write.
 */
async function resolveBookingWallets(params: {
  userId: string
  payerWallet?: string | null
  ownerId: string | undefined
}): Promise<BookingWallets> {
  const agentWallet = await resolveUserStellarWallet(params.userId, params.payerWallet)
  const hostWallet = await resolveOwnerStellarWallet(params.ownerId)
  const platformWallet =
    process.env.SAFETRUST_PLATFORM_WALLET?.trim() || DEFAULT_PLATFORM_WALLET
  return { agentWallet, hostWallet, platformWallet }
}

/**
 * Read-only eligibility gate, run before the non-refundable booking fee is
 * settled. Any unbookable request is rejected here with 409, so the guest is
 * never charged for a booking that cannot be created. The transaction below
 * repeats the checks under lock as the authoritative guard.
 */
async function assertBookingEligible(params: {
  tenantId: string
  propertyId: string
  checkIn: string
  checkOut: string
  /** The caller's own hold is a live hold that obviously overlaps itself. */
  excludeHoldId?: string
}): Promise<void> {
  const { tenantId, propertyId, checkIn, checkOut, excludeHoldId } = params

  const apartment = await db.query<{ is_available: boolean | null }>(
    `SELECT is_available
       FROM safetrust.apartments
      WHERE id = $1 AND deleted_at IS NULL`,
    [propertyId]
  )
  if (apartment.rows[0]?.is_available === false) {
    throw new ConflictError('Property is not available', { code: 'not_available' })
  }

  const overlappingHold = await db.query(
    `
    SELECT 1 FROM safetrust.booking_holds
    WHERE apartment_id = $1
      AND tenant_id = $2
      AND status IN ('active', 'pending_payment')
      AND expires_at > NOW()
      AND check_in < $4 AND check_out > $3
      AND ($5::uuid IS NULL OR id <> $5::uuid)
    LIMIT 1
    `,
    [propertyId, tenantId, checkIn, checkOut, excludeHoldId ?? null]
  )
  if (overlappingHold.rows.length > 0) {
    throw new ConflictError('Requested dates overlap with an active booking hold', {
      code: 'dates_unavailable',
    })
  }

  const overlappingRes = await db.query(
    `
    SELECT 1 FROM safetrust.reservations
    WHERE apartment_id = $1
      AND tenant_id = $2
      AND status IN ('pending', 'escrow_created', 'funded', 'checked_in', 'checked_out')
      AND check_in_date < $4 AND check_out_date > $3
    LIMIT 1
    `,
    [propertyId, tenantId, checkIn, checkOut]
  )
  if (overlappingRes.rows.length > 0) {
    throw new ConflictError('Requested dates are already booked', {
      code: 'dates_unavailable',
    })
  }
}

/** Load the hold plus its conversion artefacts, if any. */
async function loadHold(holdId: string, tenantId: string): Promise<HoldRow | undefined> {
  const holdQuery = await db.query<HoldRow>(
    `
    SELECT h.id, h.tenant_id, h.apartment_id, h.user_id,
           h.check_in, h.check_out, h.guests, h.status, h.expires_at,
           h.expires_at <= NOW() AS is_expired,
           r.id AS reservation_id,
           r.status AS reservation_status,
           e.contract_id AS contract_id,
           tx.unsigned_xdr AS unsigned_xdr,
           h.quote_deposit,
           h.asset_code
    FROM safetrust.booking_holds h
    LEFT JOIN safetrust.reservations r
      ON r.booking_hold_id = h.id
    LEFT JOIN safetrust.trustless_work_escrows e
      ON e.id = r.escrow_id
    LEFT JOIN safetrust.escrow_transactions tx
      ON tx.contract_id = e.contract_id
    WHERE h.id = $1 AND h.tenant_id = $2
    `,
    [holdId, tenantId]
  )
  return holdQuery.rows[0]
}

/**
 * Load what a booking attempt already produced: its reservation and, when the
 * attempt got that far, the deployed escrow and funding XDR.
 */
async function loadReservationAttempt(
  reservationId: string,
  tenantId: string
): Promise<ReservationAttemptRow | undefined> {
  const result = await db.query<ReservationAttemptRow>(
    `
    SELECT r.id, r.apartment_id, r.guest_id, r.check_in_date, r.check_out_date,
           e.contract_id AS contract_id,
           tx.unsigned_xdr AS unsigned_xdr
    FROM safetrust.reservations r
    LEFT JOIN safetrust.trustless_work_escrows e
      ON e.id = r.escrow_id
    LEFT JOIN safetrust.escrow_transactions tx
      ON tx.contract_id = e.contract_id
    WHERE r.id = $1 AND r.tenant_id = $2
    `,
    [reservationId, tenantId]
  )
  return result.rows[0]
}

/**
 * Deploy the Trustless Work escrow for a reservation and link it. The contract
 * ID returned by Trustless Work is the only one ever stored: if deployment is
 * not confirmed the call throws, the reservation keeps `escrow_id = NULL`, and
 * the attempt can be resumed without charging the fee again.
 */
async function deployEscrowForReservation(params: {
  reservationId: string
  propertyId: string
  userId: string
  tenantId: string
  depositAmount: string | number
  wallets: BookingWallets
}): Promise<string> {
  const { reservationId, propertyId, userId, tenantId, depositAmount, wallets } = params

  const { escrowDbId, contractId } = await deployBookingEscrow({
    apartmentId: propertyId,
    guestId: userId,
    agentWallet: wallets.agentWallet,
    hostWallet: wallets.hostWallet,
    platformWallet: wallets.platformWallet,
    depositAmount,
    tenantId,
    idempotencyKey: `escrow-deploy:${reservationId}`,
  })

  // The link is written only if this attempt is the one that claims it. A
  // concurrent attempt that won the reservation's escrow_id keeps its contract,
  // so the XDR issued below always belongs to the contract on the reservation.
  const linked = await db.query(
    `
    UPDATE safetrust.reservations
    SET escrow_id = $1, updated_at = NOW()
    WHERE id = $2 AND tenant_id = $3 AND escrow_id IS NULL
    `,
    [escrowDbId, reservationId, tenantId]
  )

  if ((linked.rowCount ?? 0) === 0) {
    const winner = await db.query<{ contract_id: string | null }>(
      `
      SELECT e.contract_id
      FROM safetrust.reservations r
      JOIN safetrust.trustless_work_escrows e ON e.id = r.escrow_id
      WHERE r.id = $1 AND r.tenant_id = $2
      `,
      [reservationId, tenantId]
    )
    const winningContract = winner.rows[0]?.contract_id
    if (!winningContract) {
      throw new ServiceUnavailableError(
        'Reservation escrow could not be linked or read back'
      )
    }

    logger.warn('agent_booking.escrow_link_reused', {
      reservationId,
      attemptedContract: contractId,
      winningContract,
    })
    return winningContract
  }

  return contractId
}

/**
 * Finish a freshly created reservation: deploy its escrow and issue the
 * unsigned fund_escrow XDR the agent has to sign.
 */
async function finishNewBooking(params: {
  reservationId: string
  propertyId: string
  userId: string
  tenantId: string
  depositAmount: string | number
  asset: string
  wallets: BookingWallets
}): Promise<CreateBookingResult> {
  const { reservationId, propertyId, userId, tenantId, depositAmount, asset, wallets } = params

  const contractId = await deployEscrowForReservation({
    reservationId,
    propertyId,
    userId,
    tenantId,
    depositAmount,
    wallets,
  })

  const unsignedXdr = await generateFundEscrowXdr({
    contractId,
    agentWallet: wallets.agentWallet,
    hostWallet: wallets.hostWallet,
    propertyId,
    depositAmount,
    tenantId,
  })

  logger.info('agent_booking.created', {
    reservationId,
    contractId,
    deposit: depositAmount,
    agentWallet: wallets.agentWallet,
  })

  return {
    reservation_id: reservationId,
    contract_id: contractId,
    deposit: Number(depositAmount).toFixed(2),
    asset,
    unsigned_xdr: unsignedXdr,
  }
}

/**
 * Resume a booking attempt whose fee was settled and whose reservation exists,
 * but whose escrow deployment or funding XDR was interrupted (for example
 * Trustless Work being unavailable, or an init transaction that still needs
 * signing). Nothing is charged again: only the missing steps run.
 */
async function resumeBookingAttempt(params: {
  reservationId: string
  propertyId: string
  checkIn: string
  checkOut: string
  guests?: number
  userId: string
  tenantId: string
  payerWallet?: string | null
}): Promise<CreateBookingResult> {
  const { reservationId, propertyId, checkIn, checkOut, guests, userId, tenantId, payerWallet } =
    params

  const attempt = await loadReservationAttempt(reservationId, tenantId)
  if (!attempt) {
    throw new ConflictError('Booking attempt not found', { code: 'booking_attempt_missing' })
  }

  const quote = await getQuoteForProperty(propertyId, checkIn, checkOut, guests)
  const wallets = await resolveBookingWallets({ userId, payerWallet, ownerId: quote.ownerId })
  const depositAmount = quote.deposit

  let contractId = attempt.contract_id
  let unsignedXdr = attempt.unsigned_xdr

  if (!contractId) {
    contractId = await deployEscrowForReservation({
      reservationId,
      propertyId,
      userId,
      tenantId,
      depositAmount,
      wallets,
    })
  }

  if (!unsignedXdr) {
    unsignedXdr = await generateFundEscrowXdr({
      contractId,
      agentWallet: wallets.agentWallet,
      hostWallet: wallets.hostWallet,
      propertyId,
      depositAmount,
      tenantId,
    })
  }

  logger.info('agent_booking.resumed', { reservationId, contractId })

  return {
    reservation_id: reservationId,
    contract_id: contractId,
    deposit: Number(depositAmount).toFixed(2),
    asset: quote.asset,
    unsigned_xdr: unsignedXdr,
    is_existing: true,
  }
}

/**
 * Validate that a settled (hold-less) payment proof's reservation is this exact
 * booking, then return or resume it. A proof that paid for another property,
 * guest or date range can never authorize this one.
 */
async function resumeSettledBooking(params: {
  reservationId: string
  propertyId: string
  checkIn: string
  checkOut: string
  guests?: number
  userId: string
  tenantId: string
  payerWallet?: string | null
  deposit: string | number
  asset: string
}): Promise<CreateBookingResult> {
  const {
    reservationId,
    propertyId,
    checkIn,
    checkOut,
    guests,
    userId,
    tenantId,
    payerWallet,
    deposit,
    asset,
  } = params

  const attempt = await loadReservationAttempt(reservationId, tenantId)
  const sameBooking =
    attempt !== undefined &&
    attempt.guest_id === userId &&
    attempt.apartment_id === propertyId &&
    toDateOnly(attempt.check_in_date) === checkIn &&
    toDateOnly(attempt.check_out_date) === checkOut

  if (!attempt || !sameBooking) {
    throw new ConflictError('Payment proof was already used for a different reservation', {
      code: 'settlement_reservation_mismatch',
    })
  }

  if (attempt.contract_id && attempt.unsigned_xdr) {
    return {
      reservation_id: attempt.id,
      contract_id: attempt.contract_id,
      deposit: Number(deposit).toFixed(2),
      asset,
      unsigned_xdr: attempt.unsigned_xdr,
      is_existing: true,
    }
  }

  return resumeBookingAttempt({
    reservationId: attempt.id,
    propertyId,
    checkIn,
    checkOut,
    guests,
    userId,
    tenantId,
    payerWallet,
  })
}

/**
 * Create a booking reservation with backend-deployed Trustless Work escrow
 * and server-calculated deposit amount.
 *
 * Fee/booking ordering, in both flows:
 *
 *  1. Read-only eligibility and wallet checks run first, so an unbookable
 *     request or a missing owner wallet fails before payment.
 *  2. For a hold, the conversion is claimed by locking the hold row and the
 *     fee is settled while that lock is held. Concurrent requests for the same
 *     hold block on the lock instead of settling twice, and the hold's expiry
 *     is re-checked under the lock immediately before the charge, so an
 *     expired hold can never take the fee without producing a reservation.
 *  3. The settlement receipt is durable. If anything after the charge fails,
 *     the hold stays active (the transaction rolled back) or the reservation
 *     stays without an escrow (converted hold), and a retry of the same
 *     request reuses the settled receipt instead of charging again.
 */
export async function createAgentBooking(
  params: CreateBookingParams
): Promise<CreateBookingResult> {
  const {
    userId,
    tenantId,
    holdId,
    propertyId: directPropertyId,
    checkIn: directCheckIn,
    checkOut: directCheckOut,
    guests: directGuests,
    payerWallet,
    chargeBookingFee,
    bindBookingFeeReservation,
    resolveBookingFeeBinding,
  } = params

  // ── 1. Hold-based flow (Preferred) ─────────────────────────────────────────
  if (holdId) {
    const hold = await loadHold(holdId, tenantId)

    // Requirement: verify hold is active, unexpired, and owned by the caller (return 409 otherwise)
    if (!hold) {
      throw new ConflictError('Hold not found', { code: 'hold_not_found' })
    }

    if (hold.user_id !== userId) {
      throw new ConflictError('Hold is not owned by the caller', { code: 'hold_not_owned' })
    }

    // Idempotency check: retrying the same converted hold returns existing reservation and XDR
    if (hold.status === 'converted') {
      // The reservation created from this hold may have been cancelled (by the
      // guest, or by the hold-expiry sweep while the deposit stayed unfunded).
      // Its dates are free again, so the hold can never produce a booking.
      if (hold.reservation_status === 'cancelled') {
        throw new ConflictError('Booking for this hold was cancelled', {
          code: 'hold_expired',
        })
      }

      if (hold.reservation_id && hold.contract_id && hold.unsigned_xdr) {
        return {
          reservation_id: hold.reservation_id,
          contract_id: hold.contract_id,
          deposit: Number(hold.quote_deposit || 0).toFixed(2),
          asset: hold.asset_code || 'USDC',
          unsigned_xdr: hold.unsigned_xdr,
          is_existing: true,
        }
      }

      // Converted, but escrow deployment or XDR issuance did not complete.
      // Resume that attempt; the fee was settled once and is not charged here.
      if (!hold.reservation_id) {
        throw new ConflictError('Hold is converted but has no reservation', {
          code: 'hold_conversion_incomplete',
        })
      }
      return resumeBookingAttempt({
        reservationId: hold.reservation_id,
        propertyId: hold.apartment_id,
        checkIn: toDateOnly(hold.check_in),
        checkOut: toDateOnly(hold.check_out),
        guests: hold.guests,
        userId,
        tenantId,
        payerWallet,
      })
    }

    // A pending_payment hold is one whose fee settled but whose activation did
    // not complete. It stays convertible: the settlement below reuses the
    // receipt already bound to this hold (never charging twice) and the
    // conversion claims the row under lock.
    if (hold.status !== 'active' && hold.status !== 'pending_payment') {
      throw new ConflictError(`Hold is ${hold.status}`, { code: 'hold_not_active' })
    }

    if (hold.is_expired) {
      throw new ConflictError('Hold has expired', { code: 'hold_expired' })
    }

    const propertyId = hold.apartment_id
    const checkIn = toDateOnly(hold.check_in)
    const checkOut = toDateOnly(hold.check_out)
    const guests = hold.guests

    // Recompute quote strictly on the server (never trusting client amounts)
    const quote = await getQuoteForProperty(propertyId, checkIn, checkOut, guests)

    // The hold is active and unexpired: re-check that the dates are still
    // bookable, then settle the fee. The converted-hold path above returned
    // already, so an idempotent retry never reaches this settlement.
    await assertBookingEligible({
      tenantId,
      propertyId,
      checkIn,
      checkOut,
      excludeHoldId: holdId,
    })

    // Escrow roles resolve before the charge: a missing owner wallet must fail
    // before the guest's non-refundable fee is settled.
    const wallets = await resolveBookingWallets({
      userId,
      payerWallet,
      ownerId: quote.ownerId,
    })

    const reservationId = await withTransaction(async (client: PoolClient) => {
      if (Number(quote.deposit) <= 0) {
        throw new ValidationError('Deposit amount must be positive')
      }

      // Claim this hold's conversion by locking its row. Concurrent requests
      // for the same hold wait here rather than settling the fee twice.
      const locked = await client.query<{ id: string; status: string; expires_at: Date; is_expired: boolean }>(
        `SELECT id, status, expires_at, (expires_at <= clock_timestamp()) AS is_expired
           FROM safetrust.booking_holds
          WHERE id = $1 AND tenant_id = $2
          FOR NO KEY UPDATE`,
        [holdId, tenantId]
      )
      if (!locked.rows[0]) {
        throw new ConflictError('Hold not found', { code: 'hold_not_found' })
      }
      if (
        locked.rows[0].status !== 'active' &&
        locked.rows[0].status !== 'pending_payment'
      ) {
        throw new ConflictError('Hold state changed concurrently', { code: 'hold_conflict' })
      }
      const lockExpired =
        Boolean(locked.rows[0].is_expired) ||
        (locked.rows[0].expires_at != null && new Date(locked.rows[0].expires_at).getTime() <= Date.now())
      // Checked under the lock, immediately before payment: an expired hold is
      // rejected while nothing has been charged, so it can never leave a
      // settled fee without a reservation.
      if (lockExpired) {
        throw new ConflictError('Hold has expired', { code: 'hold_expired' })
      }

      // Settle while holding the lock. A failure rolls the transaction back,
      // leaving the hold active so the retry can reuse the receipt/charge.
      if (chargeBookingFee) {
        await chargeBookingFee()
      }

      // 1. Transition hold to converted (from active, or from a paid but
      // never-activated pending_payment hold).
      const holdUpdate = await client.query(
        `UPDATE safetrust.booking_holds
         SET status = 'converted', updated_at = NOW()
         WHERE id = $1 AND status IN ('active', 'pending_payment')`,
        [holdId]
      )
      if (holdUpdate.rowCount !== 1) {
        throw new ConflictError('Failed to convert hold', { code: 'hold_conversion_failed' })
      }

      // 2. Create reservation in escrow_created status
      const resInsert = await client.query<{ id: string }>(
        `
        INSERT INTO safetrust.reservations (
          apartment_id,
          guest_id,
          booking_hold_id,
          check_in_date,
          check_out_date,
          total_amount,
          asset_code,
          status,
          tenant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'escrow_created', $8)
        RETURNING id
        `,
        [
          propertyId,
          userId,
          holdId,
          checkIn,
          checkOut,
          Number(quote.total),
          quote.asset,
          tenantId,
        ]
      )

      return resInsert.rows[0].id
    })

    return finishNewBooking({
      reservationId,
      propertyId,
      userId,
      tenantId,
      depositAmount: quote.deposit,
      asset: quote.asset,
      wallets,
    })
  }

  // ── 2. Direct booking flow without hold ─────────────────────────────────────
  if (!directPropertyId || !directCheckIn || !directCheckOut) {
    throw new ValidationError('Either hold_id or property_id, check_in, and check_out are required')
  }

  const propertyId = directPropertyId
  const checkIn = directCheckIn
  const checkOut = directCheckOut
  const guests = directGuests

  const quote = await getQuoteForProperty(propertyId, checkIn, checkOut, guests)

  // A settled proof may already have produced this reservation: its escrow
  // deployment or XDR issuance can have been interrupted. Resolve that binding
  // before the eligibility gate, because the attempt's own `escrow_created`
  // row overlaps the dates it is retried with and the gate would otherwise
  // reject the retry as dates_unavailable. Nothing is charged again.
  const settledReservationId = resolveBookingFeeBinding
    ? await resolveBookingFeeBinding()
    : null
  if (settledReservationId) {
    return resumeSettledBooking({
      reservationId: settledReservationId,
      propertyId,
      checkIn,
      checkOut,
      guests,
      userId,
      tenantId,
      payerWallet,
      deposit: quote.deposit,
      asset: quote.asset,
    })
  }

  // Reject unavailable properties and overlapping dates before charging, so
  // a 409 never costs the guest the non-refundable fee.
  await assertBookingEligible({ tenantId, propertyId, checkIn, checkOut })

  const wallets = await resolveBookingWallets({
    userId,
    payerWallet,
    ownerId: quote.ownerId,
  })

  // Settle the booking fee before creating the reservation.
  const fee = chargeBookingFee ? await chargeBookingFee() : undefined

  // One settled proof authorizes at most one reservation. A settlement that
  // landed concurrently may already be bound to a reservation; return or resume
  // it instead of creating a second one.
  if (fee?.reservationId) {
    return resumeSettledBooking({
      reservationId: fee.reservationId,
      propertyId,
      checkIn,
      checkOut,
      guests,
      userId,
      tenantId,
      payerWallet,
      deposit: quote.deposit,
      asset: quote.asset,
    })
  }

  // Atomic insert with overlap check
  const reservationId = await withTransaction(async (client: PoolClient) => {
    // Check for overlapping active holds
    const overlappingHold = await client.query(
      `
      SELECT 1 FROM safetrust.booking_holds
      WHERE apartment_id = $1
        AND tenant_id = $2
        AND status IN ('active', 'pending_payment')
        AND expires_at > NOW()
        AND check_in < $4 AND check_out > $3
      LIMIT 1
      `,
      [propertyId, tenantId, checkIn, checkOut]
    )

    if (overlappingHold.rows.length > 0) {
      throw new ConflictError('Requested dates overlap with an active booking hold', {
        code: 'dates_unavailable',
      })
    }

    if (Number(quote.deposit) <= 0) {
      throw new ValidationError('Deposit amount must be positive')
    }

    const aptAvailability = await client.query<{ is_available: boolean | null }>(
      `SELECT is_available FROM safetrust.apartments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [propertyId]
    )
    if (aptAvailability.rows[0]?.is_available === false) {
      throw new ConflictError('Property is not available', { code: 'not_available' })
    }

    // Check for overlapping pending or active reservations
    const overlappingRes = await client.query(
      `
      SELECT 1 FROM safetrust.reservations
      WHERE apartment_id = $1
        AND tenant_id = $2
        AND status IN ('pending', 'escrow_created', 'funded', 'checked_in', 'checked_out')
        AND check_in_date < $4 AND check_out_date > $3
      LIMIT 1
      `,
      [propertyId, tenantId, checkIn, checkOut]
    )

    if (overlappingRes.rows.length > 0) {
      throw new ConflictError('Requested dates are already booked', {
        code: 'dates_unavailable',
      })
    }

    let resInsert
    try {
      resInsert = await client.query<{ id: string }>(
        `
        INSERT INTO safetrust.reservations (
          apartment_id,
          guest_id,
          check_in_date,
          check_out_date,
          total_amount,
          asset_code,
          status,
          tenant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, 'escrow_created', $7)
        RETURNING id
        `,
        [
          propertyId,
          userId,
          checkIn,
          checkOut,
          Number(quote.total),
          quote.asset,
          tenantId,
        ]
      )
    } catch (error) {
      if ((error as { code?: string }).code === '23P01') {
        throw new ConflictError('Requested dates are already booked', {
          code: 'dates_unavailable',
        })
      }
      throw error
    }

    const newReservationId = resInsert.rows[0].id

    // Bind the settled proof on the same client: if it already paid for a
    // different reservation the insert is rolled back, so a failed bind never
    // leaves a reservation behind that no proof can authorize.
    if (bindBookingFeeReservation) {
      await bindBookingFeeReservation(newReservationId, client)
    }

    return newReservationId
  })

  // ── 3. Deploy escrow & issue funding XDR ───────────────────────────────────
  return finishNewBooking({
    reservationId,
    propertyId,
    userId,
    tenantId,
    depositAmount: quote.deposit,
    asset: quote.asset,
    wallets,
  })
}

/**
 * Submit signed fund_escrow XDR for a reservation.
 * Verifies session ownership and delegates directly to confirmation.service.
 * Crucial invariant: does NOT advance reservation status to 'funded'.
 */
export async function submitAgentBooking(
  params: SubmitBookingParams
): Promise<SubmitBookingResult> {
  const { reservationId, userId, tenantId, signedXdr } = params

  if (!signedXdr || typeof signedXdr !== 'string') {
    throw new ValidationError('signed_xdr is required and must be a string')
  }

  // 1. Verify session ownership of the reservation
  const resQuery = await db.query<{
    id: string
    guest_id: string
    apartment_id: string
    status: string
    escrow_id: string | null
    contract_id: string | null
  }>(
    `
    SELECT r.id, r.guest_id, r.apartment_id, r.status, r.escrow_id,
           e.contract_id AS contract_id
    FROM safetrust.reservations r
    LEFT JOIN safetrust.trustless_work_escrows e
      ON e.id = r.escrow_id
    WHERE r.id = $1 AND r.tenant_id = $2
    `,
    [reservationId, tenantId]
  )

  const reservation = resQuery.rows[0]
  if (!reservation) {
    throw new NotFoundError('Reservation not found')
  }

  if (reservation.guest_id !== userId) {
    throw new ForbiddenError('Not your reservation')
  }

  const contractId = reservation.contract_id
  if (!contractId) {
    throw new ValidationError('Reservation does not have an associated escrow contract')
  }

  // 2. Delegate directly to existing confirmation.service.ts
  const network = (process.env.STELLAR_NETWORK as StellarNetwork) || 'testnet'
  const confirmationResult = await processHelperSubmission({
    signedXdr,
    escrowId: contractId,
    action: 'fund',
    network,
    isTWGenerated: true,
  })

  if (!confirmationResult.success) {
    return {
      success: false,
      reservation_id: reservationId,
      contract_id: contractId,
      stage: confirmationResult.stage,
      error: confirmationResult.error,
      retryRecordId: confirmationResult.retryRecordId,
      status: reservation.status, // Stays escrow_created!
    }
  }

  // 3. Return confirmation response without marking reservation as funded
  // The transition to 'funded' is reserved exclusively for the Issue 03 on-chain balance poller
  return {
    success: true,
    reservation_id: reservationId,
    contract_id: contractId,
    tx_hash: confirmationResult.txHash,
    status: reservation.status, // Stays escrow_created!
  }
}
