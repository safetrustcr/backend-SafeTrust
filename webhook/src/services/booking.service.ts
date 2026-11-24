import { PoolClient } from 'pg'
import db, { withTransaction } from './db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'
import { getQuoteForProperty, QuoteResult } from './quote'
import { deployBookingEscrow, generateFundEscrowXdr } from './escrow-deployment.service'
import { processHelperSubmission, StellarNetwork } from './confirmation.service'
import { logger } from '../middleware/logger'

const STELLAR_ADDR_RE = /^[GC][A-Z2-7]{55}$/
const DEFAULT_PLATFORM_WALLET = 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM'
const DEFAULT_HOST_WALLET = 'GBHOSTDEFAULT0000000000000000000000000000000000000000000000'

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
  chargeBookingFee?: () => Promise<void>
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
 * Create a booking reservation with backend-deployed Trustless Work escrow
 * and server-calculated deposit amount.
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
  } = params

  let reservationId: string
  let propertyId: string
  let checkIn: string
  let checkOut: string
  let guests: number | undefined
  let quote: QuoteResult

  // ── 1. Hold-based flow (Preferred) ─────────────────────────────────────────
  if (holdId) {
    // Check hold existence and state
    const holdQuery = await db.query<{
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
      contract_id: string | null
      unsigned_xdr: string | null
      quote_deposit: string | null
      asset_code: string | null
    }>(
      `
      SELECT h.id, h.tenant_id, h.apartment_id, h.user_id,
             h.check_in, h.check_out, h.guests, h.status, h.expires_at,
             h.expires_at <= NOW() AS is_expired,
             r.id AS reservation_id,
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

    const hold = holdQuery.rows[0]

    // Requirement: verify hold is active, unexpired, and owned by the caller (return 409 otherwise)
    if (!hold) {
      throw new ConflictError('Hold not found', { code: 'hold_not_found' })
    }

    if (hold.user_id !== userId) {
      throw new ConflictError('Hold is not owned by the caller', { code: 'hold_not_owned' })
    }

    // Idempotency check: retrying the same converted hold returns existing reservation and XDR
    if (hold.status === 'converted') {
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
    }

    if (hold.status !== 'active') {
      throw new ConflictError(`Hold is ${hold.status}`, { code: 'hold_not_active' })
    }

    if (hold.is_expired) {
      throw new ConflictError('Hold has expired', { code: 'hold_expired' })
    }

    propertyId = hold.apartment_id
    checkIn = hold.check_in instanceof Date ? hold.check_in.toISOString().slice(0, 10) : String(hold.check_in).slice(0, 10)
    checkOut = hold.check_out instanceof Date ? hold.check_out.toISOString().slice(0, 10) : String(hold.check_out).slice(0, 10)
    guests = hold.guests

    // Recompute quote strictly on the server (never trusting client amounts)
    quote = await getQuoteForProperty(propertyId, checkIn, checkOut, guests)

    // The hold is active and unexpired: settle the booking fee before the
    // reservation is created. The converted-hold path above returned already,
    // so an idempotent retry never reaches this settlement.
    if (chargeBookingFee) {
      await chargeBookingFee()
    }

    // Execute atomic DB transaction: hold -> converted, reservation -> escrow_created
    reservationId = await withTransaction(async (client: PoolClient) => {
      if (Number(quote.deposit) <= 0) {
        throw new ValidationError('Deposit amount must be positive')
      }

      // Re-lock hold with FOR UPDATE to prevent concurrency races
      const locked = await client.query<{ id: string; status: string; expires_at: Date; is_expired: boolean }>(
        `SELECT id, status, expires_at, (expires_at <= clock_timestamp()) AS is_expired
           FROM safetrust.booking_holds
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [holdId, tenantId]
      )
      if (!locked.rows[0]) {
        throw new ConflictError('Hold not found', { code: 'hold_not_found' })
      }
      const lockExpired =
        Boolean(locked.rows[0].is_expired) ||
        (locked.rows[0].expires_at != null && new Date(locked.rows[0].expires_at).getTime() <= Date.now())
      if (lockExpired) {
        throw new ConflictError('Hold has expired', { code: 'hold_expired' })
      }
      if (locked.rows[0].status !== 'active') {
        throw new ConflictError('Hold state changed concurrently', { code: 'hold_conflict' })
      }

      // 1. Transition hold to converted
      const holdUpdate = await client.query(
        `UPDATE safetrust.booking_holds
         SET status = 'converted', updated_at = NOW()
         WHERE id = $1 AND status = 'active'`,
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
  } else {
    // ── 2. Direct booking flow without hold ───────────────────────────────────
    if (!directPropertyId || !directCheckIn || !directCheckOut) {
      throw new ValidationError('Either hold_id or property_id, check_in, and check_out are required')
    }

    propertyId = directPropertyId
    checkIn = directCheckIn
    checkOut = directCheckOut
    guests = directGuests

    quote = await getQuoteForProperty(propertyId, checkIn, checkOut, guests)

    // Settle the booking fee before creating the reservation.
    if (chargeBookingFee) {
      await chargeBookingFee()
    }

    // Atomic insert with overlap check
    reservationId = await withTransaction(async (client: PoolClient) => {
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

      return resInsert.rows[0].id
    })
  }

  // ── 3. Resolve Wallets & Escrow Roles ───────────────────────────────────────
  const agentWallet = await resolveUserStellarWallet(userId, payerWallet)
  const hostWallet = await resolveOwnerStellarWallet(quote.ownerId)
  const platformWallet = process.env.SAFETRUST_PLATFORM_WALLET?.trim() || DEFAULT_PLATFORM_WALLET

  // ── 4. Deploy Trustless Work Escrow for Deposit ─────────────────────────────
  // Deployed and signed by the backend for the server-calculated deposit amount
  const { escrowDbId, contractId } = await deployBookingEscrow({
    apartmentId: propertyId,
    guestId: userId,
    agentWallet,
    hostWallet,
    platformWallet,
    depositAmount: quote.deposit,
    tenantId,
  })

  // Link reservation to the created escrow
  await db.query(
    `
    UPDATE safetrust.reservations
    SET escrow_id = $1, updated_at = NOW()
    WHERE id = $2
    `,
    [escrowDbId, reservationId]
  )

  // ── 5. Generate Unsigned fund_escrow XDR ────────────────────────────────────
  // The agent's wallet is the signer for depositing its own security deposit
  const unsignedXdr = await generateFundEscrowXdr({
    contractId,
    agentWallet,
    hostWallet,
    propertyId,
    depositAmount: quote.deposit,
    tenantId,
  })

  logger.info('agent_booking.created', {
    reservationId,
    contractId,
    deposit: quote.deposit,
    agentWallet,
  })

  return {
    reservation_id: reservationId,
    contract_id: contractId,
    deposit: quote.deposit,
    asset: quote.asset,
    unsigned_xdr: unsignedXdr,
  }
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
