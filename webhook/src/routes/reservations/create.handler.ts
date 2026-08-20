'use strict'

import { Response } from 'express'
import { hasuraRequest } from '../../services/hasura'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { CreateReservationPayload, Reservation } from '@safetrust/types'

interface CreateReservationHasuraResponse {
  insert_reservations_one: Reservation | null
}

export const createReservationHandler = async (
  req: AuthenticatedRequest & { body: CreateReservationPayload },
  res: Response
): Promise<Response> => {
  const guestId = req.user?.uid
  const { apartment_id, check_in_date, check_out_date, total_amount, asset_code } = req.body

  // 1 — Validate required fields
  if (!guestId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!apartment_id || !check_in_date || !check_out_date || total_amount === undefined || total_amount === null) {
    return res.status(400).json({
      error: 'Missing required fields: apartment_id, check_in_date, check_out_date, total_amount'
    })
  }

  // Validate dates — reject invalid date strings before comparing
  const checkIn = new Date(check_in_date)
  const checkOut = new Date(check_out_date)
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
    return res.status(400).json({
      error: 'check_out_date must be a valid date after check_in_date'
    })
  }

  // Validate amount — reject non-numeric and non-finite values
  if (typeof total_amount !== 'number' || !Number.isFinite(total_amount) || total_amount <= 0) {
    return res.status(400).json({
      error: 'total_amount must be greater than zero'
    })
  }

  // 2 — Insert reservation via Hasura GraphQL
  const mutation = `
    mutation CreateReservation($object: reservations_insert_input!) {
      insert_reservations_one(object: $object) {
        id
        apartment_id
        guest_id
        status
        check_in_date
        check_out_date
        total_amount
        asset_code
        escrow_id
        created_at
      }
    }
  `

  try {
    const data = await hasuraRequest<CreateReservationHasuraResponse>(mutation, {
      object: {
        apartment_id,
        guest_id: guestId,
        check_in_date,
        check_out_date,
        total_amount,
        asset_code: asset_code || 'USDC',
        status: 'pending',
        tenant_id: 'safetrust',
      }
    })

    const reservation = data.insert_reservations_one
    if (!reservation) {
      return res.status(500).json({ error: 'Failed to create reservation' })
    }

    console.log(`[reservations/create] ✅ Reservation created — id: ${reservation.id}`)
    return res.status(201).json({ reservation })

  } catch (error) {
    const err = error as Error & { details?: unknown }
    console.error('[reservations/create] ❌ error:', err.details || err.message)
    if (err.details) {
      return res.status(500).json({ error: 'Failed to create reservation', details: err.details })
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message })
  }
}
