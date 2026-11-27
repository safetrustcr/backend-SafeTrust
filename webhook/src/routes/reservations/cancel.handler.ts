import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import {
  findReservationById,
  updateReservationCancellation,
} from '../../repositories/reservation.repository'
import {
  ReservationDto,
  toReservationDto,
} from '../../services/reservation-actions'
import {
  AuthError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors'

type CancelReservationResponse =
  | ReservationDto
  | { error: string; status?: string }

export const cancelReservationHandler = async (
  req: AuthenticatedRequest,
  res: Response<CancelReservationResponse>
): Promise<Response<CancelReservationResponse>> => {
  const userId = req.context?.uid || req.user?.uid
  if (!userId) {
    throw new AuthError('Unauthorized')
  }

  const { id } = req.params
  if (typeof id !== 'string' || !id) {
    throw new ValidationError('Missing reservation id')
  }

  const { reason } = req.body || {}
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string') {
      throw new ValidationError('Reason must be a string')
    }
    if (reason.length > 500) {
      throw new ValidationError('Cancellation reason must be 500 characters or less')
    }
  }

  const reservation = await findReservationById(id)

  // Not guest/owner, or missing -> 404
  if (!reservation || (reservation.guest_id !== userId && reservation.owner_id !== userId)) {
    throw new NotFoundError('Reservation not found')
  }

  // Already cancelled -> 200 + DTO (idempotent retry)
  if (reservation.status === 'cancelled') {
    const dto = toReservationDto(reservation, userId)
    return res.status(200).json(dto)
  }

  // Status is funded or later -> 409 { error: 'RESERVATION_NOT_CANCELLABLE', status }
  if (reservation.status !== 'pending' && reservation.status !== 'escrow_created') {
    throw new ConflictError('RESERVATION_NOT_CANCELLABLE', {
      code: 'reservation_not_cancellable',
      details: { status: reservation.status },
    })
  }

  // Cancellation is allowed for pending or escrow_created
  const didCancel = await updateReservationCancellation(id, userId, reason)
  const current = await findReservationById(id)

  if (!current) {
    throw new NotFoundError('Reservation not found')
  }

  if (!didCancel && current.status !== 'cancelled') {
    throw new ConflictError('RESERVATION_NOT_CANCELLABLE', {
      code: 'reservation_not_cancellable',
      details: { status: current.status },
    })
  }

  return res.status(200).json(toReservationDto(current, userId))
}
