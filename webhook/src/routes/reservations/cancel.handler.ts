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

type CancelReservationResponse =
  | ReservationDto
  | { error: string; status?: string }

export const cancelReservationHandler = async (
  req: AuthenticatedRequest,
  res: Response<CancelReservationResponse>
): Promise<Response<CancelReservationResponse>> => {
  const userId = req.user?.uid
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { id } = req.params
  if (!id) {
    return res.status(400).json({ error: 'Missing reservation id' })
  }

  const { reason } = req.body || {}
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string') {
      return res.status(400).json({ error: 'Reason must be a string' })
    }
    if (reason.length > 500) {
      return res.status(400).json({
        error: 'Cancellation reason must be 500 characters or less',
      })
    }
  }

  try {
    const reservation = await findReservationById(id)

    // Not guest/owner, or missing -> 404
    if (!reservation || (reservation.guest_id !== userId && reservation.owner_id !== userId)) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    // Already cancelled -> 200 + DTO (idempotent retry)
    if (reservation.status === 'cancelled') {
      const dto = toReservationDto(reservation, userId)
      return res.status(200).json(dto)
    }

    // Status is funded or later -> 409 { error: 'RESERVATION_NOT_CANCELLABLE', status }
    if (reservation.status !== 'pending' && reservation.status !== 'escrow_created') {
      return res.status(409).json({
        error: 'RESERVATION_NOT_CANCELLABLE',
        status: reservation.status,
      })
    }

    // Cancellation is allowed for pending or escrow_created
    const didCancel = await updateReservationCancellation(id, userId, reason)
    const current = await findReservationById(id)

    if (!current) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    if (!didCancel && current.status !== 'cancelled') {
      return res.status(409).json({
        error: 'RESERVATION_NOT_CANCELLABLE',
        status: current.status,
      })
    }

    return res.status(200).json(toReservationDto(current, userId))
  } catch (error) {
    const err = error as Error
    console.error('[reservations/cancel] ❌ error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
