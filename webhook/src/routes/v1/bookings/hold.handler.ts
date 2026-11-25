import { NextFunction, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import {
  activateHold,
  createHold,
  releaseHold,
  releasePendingHold,
} from '../../../repositories/hold.repository'
import { settleBookingFee } from '../../../services/x402-settlement.service'
import { AuthError, ValidationError } from '../../../utils/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`)
  }
  return value
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
    if (!req.x402) {
      await releasePendingHold(hold.id)
      throw new ValidationError('x402 payment missing')
    }

    try {
      await settleBookingFee({
        paymentHeader: req.x402.paymentHeader,
        amountUsdc: req.x402.amountUsdc,
        payer: req.x402.payer,
        network: req.x402.network,
        purpose: 'hold_fee',
        holdId: hold.id,
      })
    } catch (error) {
      await releasePendingHold(hold.id)
      throw error
    }

    const activated = await activateHold(hold.id)
    if (!activated) {
      throw new ValidationError('Hold expired before payment was confirmed')
    }

    res.status(201).json({
      hold_id: hold.id,
      expires_at: new Date(hold.expires_at).toISOString(),
      quote: {
        total: hold.price_total,
        deposit: Number(hold.quote_deposit).toFixed(2),
        asset: hold.asset_code,
      },
    })
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
