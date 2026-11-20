import type { PoolClient } from 'pg'
import { query, withTransaction } from '../services/db'
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from '../utils/errors'

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

    const nights = Math.max(
      1,
      Math.round((Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86_400_000)
    )
    const priceTotal = (Number(apartment.price) * nights).toFixed(2)

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
  await query(
    `UPDATE safetrust.booking_holds
        SET status = 'released', updated_at = NOW()
      WHERE id = $1 AND status IN ('pending_payment', 'active')`,
    [holdId]
  )
}

/**
 * Expire holds past expires_at, and release pending_payment holds whose
 * payment was never confirmed. Returns the number of holds changed.
 */
export async function expireHolds(): Promise<number> {
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
  return (expired.rowCount ?? 0) + (stuck.rowCount ?? 0)
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
              h.expires_at <= NOW() AS is_expired
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
