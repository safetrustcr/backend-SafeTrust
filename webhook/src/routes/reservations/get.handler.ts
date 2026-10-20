import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { findReservationById } from '../../repositories/reservation.repository'
import {
  ReservationDto,
  toReservationDto,
} from '../../services/reservation-actions'

type GetReservationResponse =
  | ReservationDto
  | { error: string }

export const getReservationHandler = async (
  req: AuthenticatedRequest,
  res: Response<GetReservationResponse>
): Promise<Response<GetReservationResponse>> => {
  const userId = req.user?.uid
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { id } = req.params
  if (!id) {
    return res.status(400).json({ error: 'Missing reservation id' })
  }

  try {
    const reservation = await findReservationById(id)

    // 404 when caller is neither guest nor owner (same response as doesn't exist)
    if (!reservation || (reservation.guest_id !== userId && reservation.owner_id !== userId)) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    const dto = toReservationDto(reservation, userId)
    return res.status(200).json(dto)
  } catch (error) {
    const err = error as Error
    console.error('[reservations/get] ❌ error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
