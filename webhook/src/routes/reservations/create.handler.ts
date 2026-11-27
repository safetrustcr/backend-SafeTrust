import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { createReservation } from '../../services/reservation.service'
import type { Reservation } from '@safetrust/types'
import { logger } from '../../middleware/logger'
import { AppError, AuthError, ValidationError } from '../../utils/errors'

type CreateReservationResponse =
  | { reservation: Reservation }
  | { error: string }

export const createReservationHandler = async (
  req: AuthenticatedRequest,
  res: Response<CreateReservationResponse>
): Promise<Response<CreateReservationResponse>> => {
  const guestId = req.context?.uid || req.user?.uid
  // Tenant comes from the verified session (authMiddleware), never the body.
  const tenantId = req.context?.tenantId
  const { apartment_id, check_in_date, check_out_date, total_amount, asset_code, tenant_id } =
    req.body || {}

  // 1 — Validate required fields
  if (!guestId || !tenantId) {
    throw new AuthError('Unauthorized')
  }

  if (!apartment_id || !check_in_date || !check_out_date || !total_amount) {
    throw new ValidationError(
      'Missing required fields: apartment_id, check_in_date, check_out_date, total_amount'
    )
  }

  // Validate dates — reject invalid date strings before comparing
  const checkIn = new Date(check_in_date)
  const checkOut = new Date(check_out_date)
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
    throw new ValidationError('check_out_date must be a valid date after check_in_date')
  }

  // Validate amount — reject non-numeric and non-finite values
  if (typeof total_amount !== 'number' || !Number.isFinite(total_amount) || total_amount <= 0) {
    throw new ValidationError('total_amount must be greater than zero')
  }

  // 2 — Create the reservation through the service layer
  const reservation = await createReservation({
    tenantId,
    requestedTenantId: tenant_id,
    guestId,
    apartmentId: apartment_id,
    checkInDate: check_in_date,
    checkOutDate: check_out_date,
    totalAmount: total_amount,
    assetCode: asset_code || 'USDC',
  })

  if (!reservation) {
    throw new AppError('Failed to create reservation', 500)
  }

  logger.info('reservations.create.succeeded', { reservationId: reservation.id })
  return res.status(201).json({ reservation })
}
