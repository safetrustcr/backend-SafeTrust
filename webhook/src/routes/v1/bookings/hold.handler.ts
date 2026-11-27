import { NextFunction, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import {
  activateHold,
  createHold,
  findHoldById,
  releaseHold,
  releasePendingHold,
} from '../../../repositories/hold.repository'
import { logger } from '../../../middleware/logger'
import { findSettledHoldFee, settleBookingFee } from '../../../services/x402-settlement.service'
import {
  AuthError,
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from '../../../utils/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Activation attempts after the hold fee settled, before deferring recovery. */
const HOLD_ACTIVATION_ATTEMPTS = 3

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`)
  }
  return value
}

function toDateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

/**
 * The hold fee is settled but the hold could not be activated. Nothing is
 * released: the paid hold stays pending_payment and the same hold id/payment
 * proof can resume it, reusing the settled receipt instead of charging again.
 */
function activationPending(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    'Hold fee settled but the hold is not active yet; retry with the same payment proof',
    { code: 'hold_activation_pending' }
  )
}

function sendHold(
  res: Response,
  hold: {
    id: string
    expires_at: Date | string
    quote_deposit: string
    asset_code: string
  },
  total: string
): void {
  res.status(201).json({
    hold_id: hold.id,
    expires_at: new Date(hold.expires_at).toISOString(),
    quote: {
      total,
      deposit: Number(hold.quote_deposit).toFixed(2),
      asset: hold.asset_code,
    },
  })
}

export async function createHoldHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  let holdId: string | undefined
  try {
    const ctx = req.context
    if (!ctx) throw new AuthError()

    const body = (req.body ?? {}) as Record<string, unknown>
    const propertyId = body.property_id
    if (typeof propertyId !== 'string' || !UUID_RE.test(propertyId)) {
      throw new ValidationError('property_id must be a UUID')
    }
    const checkIn = parseDate(body.check_in, 'check_in')
    const checkOut = parseDate(body.check_out, 'check_out')
    if (Date.parse(checkOut) <= Date.parse(checkIn)) {
      throw new ValidationError('check_out must be after check_in')
    }
    const guests = body.guests
    if (typeof guests !== 'number' || !Number.isInteger(guests) || guests < 1) {
      throw new ValidationError('guests must be a positive integer')
    }

    // Retry of a paid hold: the same proof is already bound to the hold this
    // request created earlier, whose activation did not complete. Resume it
    // instead of creating a second hold, which settlement would reject as
    // settlement_hold_mismatch.
    const payment = req.x402
    if (payment?.paymentHeader) {
      const settledHold = await findSettledHoldFee(
        payment.paymentHeader,
        payment.amountUsdc
      )
      if (settledHold) {
        const existing = await findHoldById(settledHold.holdId, ctx.tenantId)
        const sameHold =
          existing !== undefined &&
          existing.user_id === ctx.uid &&
          existing.apartment_id === propertyId &&
          toDateOnly(existing.check_in) === checkIn &&
          toDateOnly(existing.check_out) === checkOut &&
          existing.guests === guests

        if (!existing || !sameHold) {
          throw new ConflictError('Payment proof was already used for a different hold', {
            code: 'settlement_hold_mismatch',
          })
        }

        // A lapsed hold cannot be resumed or re-activated, even when its fee
        // was settled: the dates it blocked are free again for other guests.
        if (
          existing.status === 'expired' ||
          new Date(existing.expires_at).getTime() <= Date.now()
        ) {
          throw new ConflictError('Hold has expired', { code: 'hold_expired' })
        }

        if (existing.status === 'pending_payment') {
          if (!(await activateHold(existing.id))) {
            logger.error('booking.hold_activation_pending', { holdId: existing.id })
            throw activationPending()
          }
        } else if (existing.status !== 'active') {
          throw new ConflictError(`Hold is ${existing.status}`, { code: 'hold_not_active' })
        }

        sendHold(res, existing, existing.quote_total)
        return
      }
    }

    // Written as pending_payment first; the hold only blocks dates for others
    // as a live hold, and becomes active once the payment is confirmed.
    const hold = await createHold({
      tenantId: ctx.tenantId,
      userId: ctx.uid,
      apartmentId: propertyId,
      checkIn,
      checkOut,
      guests,
      payerAddress: req.x402?.payer ?? null,
    })
    holdId = hold.id

    // requireX402Payment only verifies the payment authorization; funds move
    // only when settlement is confirmed. Charge the hold fee before the hold
    // becomes live, and never leave a live hold behind an unpaid request.
    if (!payment?.paymentHeader) {
      await releasePendingHold(hold.id)
      throw new ValidationError('x402 payment missing')
    }

    try {
      await settleBookingFee({
        paymentHeader: payment.paymentHeader,
        amountUsdc: payment.amountUsdc,
        payer: payment.payer,
        network: payment.network,
        purpose: 'hold_fee',
        holdId: hold.id,
      })
    } catch (error) {
      // Nothing was paid, so the pending hold must not keep blocking dates.
      await releasePendingHold(hold.id)
      throw error
    }

    // The fee is settled from here on. Releasing the hold on an activation
    // failure would destroy the only record of a paid booking, so activation is
    // retried and the hold is left pending_payment for recovery with the same
    // hold id and payment proof.
    let activated = false
    let lastActivationError: unknown
    for (let attempt = 0; attempt < HOLD_ACTIVATION_ATTEMPTS && !activated; attempt++) {
      try {
        activated = await activateHold(hold.id)
        lastActivationError = undefined
      } catch (error) {
        lastActivationError = error
      }
    }
    if (!activated) {
      logger.error('booking.hold_activation_pending', {
        holdId: hold.id,
        error: lastActivationError,
      })
      throw activationPending()
    }

    sendHold(res, hold, hold.price_total)
  } catch (error) {
    next(error)
  }
}

export async function releaseHoldHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ctx = req.context
    if (!ctx) throw new AuthError()
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) throw new ValidationError('hold id must be a UUID')
    await releaseHold(id, ctx.uid, ctx.tenantId)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}
