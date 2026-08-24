'use strict'

import { Response } from 'express'
import { query } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'

export interface CreateBidRequestPayload {
  apartmentId?: string
  apartment_id?: string
  proposedPrice?: number | string
  proposed_price?: number | string
  desiredMoveIn?: string
  desired_move_in?: string
}

export interface BidRequest {
  id: string
  apartment_id: string
  tenant_id: string
  proposed_price: number | string
  desired_move_in: string
  current_status: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

// Mirrors the check_active_bids trigger: one active bid per tenant across all apartments
const EXISTING_ACTIVE = `
  SELECT id FROM public.bid_requests
  WHERE tenant_id = $1
    AND current_status IN ('PENDING', 'VIEWED', 'APPROVED')
    AND deleted_at IS NULL
  LIMIT 1
`

const INSERT_BID = `
  INSERT INTO public.bid_requests
    (apartment_id, tenant_id, proposed_price, desired_move_in, current_status)
  VALUES ($1, $2, $3, $4, 'PENDING')
  RETURNING *
`

export const createBidRequestHandler = async (
  req: AuthenticatedRequest & { body: CreateBidRequestPayload },
  res: Response
): Promise<Response> => {
  const { uid } = req.user || {}
  const apartmentId = req.body?.apartmentId || req.body?.apartment_id
  const proposedPrice = req.body?.proposedPrice || req.body?.proposed_price
  const desiredMoveIn = req.body?.desiredMoveIn || req.body?.desired_move_in

  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    return res.status(400).json({
      error: 'Missing required fields',
    })
  }

  const price = Number(proposedPrice)
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'proposedPrice must be a positive number' })
  }

  const moveIn = new Date(desiredMoveIn)
  if (isNaN(moveIn.getTime())) {
    return res.status(400).json({ error: 'desiredMoveIn must be a valid date' })
  }

  try {
    const existing = await query<{ id: string }>(EXISTING_ACTIVE, [uid])
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate pending bid',
      })
    }

    const result = await query<BidRequest>(INSERT_BID, [
      apartmentId,
      uid,
      price,
      moveIn.toISOString(),
    ])
    const bid = result.rows[0]

    // bid_status_histories entry is inserted automatically by the record_bid_status trigger

    console.log(`[bid-requests/create] bid created — id: ${bid.id}`)
    return res.status(201).json({ bid })
  } catch (error) {
    const err = error as Error
    // The check_active_bids trigger raises this on concurrent duplicate inserts
    if (err.message && err.message.includes('Tenant already has an active bid')) {
      return res.status(409).json({
        error: 'Duplicate pending bid',
      })
    }
    console.error('[bid-requests/create]', err.message)
    return res.status(500).json({ error: 'Failed to create bid request' })
  }
}
