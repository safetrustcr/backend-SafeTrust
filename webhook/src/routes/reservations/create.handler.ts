import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { createReservation, TenantMismatchError } from '../../services/reservation.service'
import type { Reservation } from '@safetrust/types'

type CreateReservationResponse =
  | { reservation: Reservation }
  | { error: string; details?: unknown }

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
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!apartment_id || !check_in_date || !check_out_date || !total_amount) {
    return res.status(400).json({
      error: 'Missing required fields: apartment_id, check_in_date, check_out_date, total_amount',
    })
  }

  // Validate dates — reject invalid date strings before comparing
  const checkIn = new Date(check_in_date)
  const checkOut = new Date(check_out_date)
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
    return res.status(400).json({
      error: 'check_out_date must be a valid date after check_in_date',
    })
  }

  // Validate amount — reject non-numeric and non-finite values
  if (typeof total_amount !== 'number' || !Number.isFinite(total_amount) || total_amount <= 0) {
    return res.status(400).json({
      error: 'total_amount must be greater than zero',
    })
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

    console.log(`[reservations/create] ✅ Reservation created — id: ${reservation.id}`)
    return res.status(201).json({ reservation })
  } catch (error) {
    if (error instanceof TenantMismatchError) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' })
    }

    const err = error as Error & { details?: unknown }
    console.error('[reservations/create] ❌ error:', err.details || err.message)
    if (err.details) {
      return res.status(500).json({ error: 'Failed to create reservation', details: err.details })
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message })
  }
}
