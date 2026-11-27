import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { findReservationById } from '../../repositories/reservation.repository'
import {
  ReservationDto,
  toReservationDto,
} from '../../services/reservation-actions'
import { AuthError, NotFoundError, ValidationError } from '../../utils/errors'

type GetReservationResponse =
  | ReservationDto
  | { error: string }

export const getReservationHandler = async (
  req: AuthenticatedRequest,
  res: Response<GetReservationResponse>
): Promise<Response<GetReservationResponse>> => {
  const userId = req.context?.uid || req.user?.uid
  if (!userId) {
    throw new AuthError('Unauthorized')
  }

  const { id } = req.params
  if (typeof id !== 'string' || !id) {
    throw new ValidationError('Missing reservation id')
  }

  const reservation = await findReservationById(id)

  // 404 when caller is neither guest nor owner (same response as doesn't exist)
  if (!reservation || (reservation.guest_id !== userId && reservation.owner_id !== userId)) {
    throw new NotFoundError('Reservation not found')
  }

  const dto = toReservationDto(reservation, userId)
  return res.status(200).json(dto)
}
