import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { createReservation, TenantMismatchError } from '../../services/reservation.service'
import type { Reservation } from '@safetrust/types'
import { logger } from '../../middleware/logger'
import type { CreateReservationBody } from '../../validation'

type CreateReservationResponse =
  | { reservation: Reservation }
  | { error: string }

export const createReservationHandler = async (
  req: AuthenticatedRequest & { body: CreateReservationBody },
  res: Response<CreateReservationResponse>
): Promise<Response<CreateReservationResponse>> => {
  const guestId = req.context?.uid || req.user?.uid
  // Tenant comes from the verified session (authMiddleware), never the body.
  const tenantId = req.context?.tenantId
  const { apartment_id, check_in_date, check_out_date, total_amount, asset_code, tenant_id } = req.body

  // 1 — Validate required fields
  if (!guestId || !tenantId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 2 — Create the reservation through the service layer
  try {
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
      return res.status(500).json({ error: 'Failed to create reservation' })
    }

    logger.info('reservations.create.succeeded', { reservationId: reservation.id })
    return res.status(201).json({ reservation })
  } catch (error) {
    if (error instanceof TenantMismatchError) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' })
    }

    // Log the cause; the 500 body never carries driver or Hasura detail.
    logger.error('reservations.create.failed', { error })
    return res.status(500).json({ error: 'Failed to create reservation' })
  }
}
