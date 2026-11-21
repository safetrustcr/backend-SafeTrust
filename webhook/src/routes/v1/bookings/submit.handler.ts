import { NextFunction, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { submitAgentBooking } from '../../../services/booking.service'
import { AuthError, ValidationError } from '../../../utils/errors'

export async function submitBookingHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ctx = req.context
    if (!ctx) {
      throw new AuthError()
    }

    const { id } = req.params
    if (!id) {
      throw new ValidationError('Reservation id is required')
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const signedXdr = body.signed_xdr
    if (!signedXdr || typeof signedXdr !== 'string') {
      throw new ValidationError('signed_xdr is required and must be a string')
    }

    const result = await submitAgentBooking({
      reservationId: id,
      userId: ctx.uid,
      tenantId: ctx.tenantId,
      signedXdr,
    })

    if (!result.success) {
      res.status(400).json({
        success: false,
        reservation_id: result.reservation_id,
        contract_id: result.contract_id,
        stage: result.stage,
        error: result.error,
        retryRecordId: result.retryRecordId,
        status: result.status,
      })
      return
    }

    res.status(200).json({
      success: true,
      reservation_id: result.reservation_id,
      contract_id: result.contract_id,
      tx_hash: result.tx_hash,
      status: result.status, // Remains escrow_created until poller confirms on-chain balance
    })
  } catch (error) {
    next(error)
  }
}
