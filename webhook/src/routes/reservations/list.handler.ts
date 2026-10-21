import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import {
  findReservationsByParty,
} from '../../repositories/reservation.repository'
import {
  ReservationDto,
  toReservationDto,
} from '../../services/reservation-actions'

type ListReservationsResponse =
  | { reservations: ReservationDto[] }
  | { error: string }

export const listReservationsHandler = async (
  req: AuthenticatedRequest,
  res: Response<ListReservationsResponse>
): Promise<Response<ListReservationsResponse>> => {
  const userId = req.user?.uid
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { role, limit, offset, page } = req.query

  let parsedRole: 'guest' | 'host' | undefined
  if (role && role !== 'both') {
    if (role === 'guest' || role === 'host') {
      parsedRole = role
    } else {
      return res.status(400).json({
        error: "Invalid role parameter. Must be 'guest', 'host' or 'both'",
      })
    }
  }

  const MAX_LIMIT = 100
  let parsedLimit = parseInt(String(limit ?? 50), 10)
  if (isNaN(parsedLimit) || parsedLimit < 1) parsedLimit = 50
  if (parsedLimit > MAX_LIMIT) parsedLimit = MAX_LIMIT

  let parsedOffset = parseInt(String(offset ?? 0), 10)
  if (isNaN(parsedOffset) || parsedOffset < 0) {
    parsedOffset = 0
  }

  if (page && !offset) {
    const parsedPage = parseInt(String(page), 10)
    if (!isNaN(parsedPage) && parsedPage > 1) {
      parsedOffset = (parsedPage - 1) * parsedLimit
    }
  }

  try {
    const rows = await findReservationsByParty(userId, parsedRole, parsedLimit, parsedOffset)
    const reservations = rows.map((row) => toReservationDto(row, userId))

    return res.status(200).json({ reservations })
  } catch (error) {
    const err = error as Error
    console.error('[reservations/list] ❌ error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
