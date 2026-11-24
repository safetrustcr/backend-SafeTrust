import { NextFunction, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createAgentBooking } from '../../../services/booking.service'
import { settleBookingFee } from '../../../services/x402-settlement.service'
import {
  AuthError,
  ConflictError,
  PaymentRequiredError,
  ValidationError,
} from '../../../utils/errors'

export async function createBookingHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ctx = req.context
    if (!ctx) {
      throw new AuthError()
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const holdId = body.hold_id ? String(body.hold_id) : undefined
    const propertyId = body.property_id ? String(body.property_id) : undefined
    const checkIn = body.check_in ? String(body.check_in) : undefined
    const checkOut = body.check_out ? String(body.check_out) : undefined
    const guests = typeof body.guests === 'number' ? body.guests : undefined

    if (!holdId && (!propertyId || !checkIn || !checkOut)) {
      throw new ValidationError(
        'Either hold_id or property_id, check_in, and check_out must be provided'
      )
    }

    const x402 = req.x402

    const result = await createAgentBooking({
      userId: ctx.uid,
      tenantId: ctx.tenantId,
      holdId,
      propertyId,
      checkIn,
      checkOut,
      guests,
      payerWallet: x402?.payer ?? null,
      // Settlement is durably recorded, so retries reuse the confirmed receipt.
      chargeBookingFee: async () => {
        if (!x402) {
          throw new PaymentRequiredError('x402 payment is required to create a booking')
        }
        await settleBookingFee({
          paymentHeader: x402.paymentHeader,
          amountUsdc: x402.amountUsdc,
          payer: x402.payer,
          network: x402.network,
        })
      },
    })

    const status = result.is_existing ? 200 : 201

    res.status(status).json({
      reservation_id: result.reservation_id,
      contract_id: result.contract_id,
      deposit: result.deposit,
      asset: result.asset,
      unsigned_xdr: result.unsigned_xdr,
    })
  } catch (error) {
    next(error)
  }
}
