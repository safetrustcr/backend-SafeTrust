import { NextFunction, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createAgentBooking } from '../../../services/booking.service'
import {
  bindSettlementToReservation,
  findSettledBookingFee,
  settleBookingFee,
  settlementIdempotencyKey,
} from '../../../services/x402-settlement.service'
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
      // A proof that already settled is resolved before the eligibility gate,
      // so retrying this booking resumes its own reservation instead of
      // failing on the dates that reservation itself holds.
      resolveBookingFeeBinding: async () => {
        if (!x402 || holdId) return null
        const settled = await findSettledBookingFee(x402.paymentHeader, x402.amountUsdc)
        return settled?.reservationId ?? null
      },
      // Settlement is durably recorded, so retries reuse the confirmed receipt.
      chargeBookingFee: async () => {
        if (!x402) {
          throw new PaymentRequiredError('x402 payment is required to create a booking')
        }
        const receipt = await settleBookingFee({
          paymentHeader: x402.paymentHeader,
          amountUsdc: x402.amountUsdc,
          payer: x402.payer,
          network: x402.network,
          // Binds the receipt to this hold so the same proof cannot be
          // replayed against a different one.
          holdId: holdId ?? null,
        })
        return {
          reused: receipt.reused,
          reservationId: receipt.reservationId,
        }
      },
      // A direct (hold-less) proof may authorize only one reservation: record
      // the one it paid for so a replay returns it instead of charging again.
      bindBookingFeeReservation: async (reservationId: string) => {
        if (!x402) return
        await bindSettlementToReservation(
          settlementIdempotencyKey(x402.paymentHeader, x402.amountUsdc),
          reservationId
        )
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
