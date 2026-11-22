import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import {
  findReservationsByParty,
} from '../../repositories/reservation.repository'
import {
  ReservationDto,
  toReservationDto,
} from '../../services/reservation-actions'
import { logger } from '../../middleware/logger'
import type { ReservationListQuery } from '../../validation'

type ListReservationsResponse =
  | { reservations: ReservationDto[] }
  | { error: string }

export const listReservationsHandler = async (
  req: AuthenticatedRequest & { query: ReservationListQuery },
  res: Response<ListReservationsResponse>
): Promise<Response<ListReservationsResponse>> => {
  const userId = req.context?.uid || req.user?.uid
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { role, limit, offset, page } = req.query

  const parsedRole = role === 'both' ? undefined : role

  const MAX_LIMIT = 100
  let parsedLimit = Number(limit ?? 50)
  if (parsedLimit > MAX_LIMIT) parsedLimit = MAX_LIMIT

  let parsedOffset = Number(offset ?? 0)

  if (page && offset === undefined) {
    const parsedPage = Number(page)
    if (parsedPage > 1) {
      parsedOffset = (parsedPage - 1) * parsedLimit
    }
  }

  try {
    const rows = await findReservationsByParty(userId, parsedRole, parsedLimit, parsedOffset)
    const reservations = rows.map((row) => toReservationDto(row, userId))

    return res.status(200).json({ reservations })
  } catch (error) {
    const err = error as Error
    logger.error('reservations.list.failed', { error: err })
    return res.status(500).json({ error: 'Internal server error' })
  }
}
