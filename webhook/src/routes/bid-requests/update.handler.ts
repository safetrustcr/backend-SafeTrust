'use strict'

import { Response } from 'express'
import { pool } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { BidRequest } from './create.handler'

export interface UpdateBidRequestPayload {
  status?: string
}

export interface UpdateBidRequestParams {
  id: string
}

export interface BidRequestWithOwner extends BidRequest {
  owner_id: string
}

export const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CONFIRMED', 'CANCELLED'],
}

const GET_BID = `
  SELECT br.*, a.owner_id
  FROM public.bid_requests br
  JOIN public.apartments a ON br.apartment_id = a.id
  WHERE br.id = $1 AND br.deleted_at IS NULL
  FOR UPDATE OF br
`

const UPDATE_BID = `
  UPDATE public.bid_requests
  SET current_status = $1, updated_at = NOW()
  WHERE id = $2
  RETURNING *
`

const INSERT_HISTORY = `
  INSERT INTO public.bid_status_histories
    (bid_request_id, status, changed_by)
  VALUES ($1, $2, $3)
`

/**
 * PATCH /api/bid-requests/:id — owner updates bid status with history row.
 */
export const updateBidRequestHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { uid } = req.user || {}
  const { id } = req.params as { id: string }
  const { status: newStatus } = (req.body || {}) as UpdateBidRequestPayload

  if (!newStatus) {
    return res.status(400).json({ error: 'Missing required field: status' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const userRow = await client.query<{ id: string }>(
      'SELECT id FROM public.users WHERE id = $1 OR firebase_uid = $1 LIMIT 1',
      [uid]
    )
    if (userRow.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: 'User profile not found',
        detail: 'Call POST /api/auth/sync-user before updating bid requests.',
      })
    }

    const result = await client.query<BidRequestWithOwner>(GET_BID, [id])
    if (result.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Bid not found' })
    }

    const bid = result.rows[0]

    if (bid.owner_id !== uid) {
      await client.query('ROLLBACK')
      return res.status(403).json({
        error: 'Only owner can approve',
      })
    }

    const allowed = VALID_TRANSITIONS[bid.current_status] ?? []
    if (!allowed.includes(newStatus)) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        error: 'Invalid transition',
        allowedTransitions: allowed,
      })
    }

    const updated = await client.query<BidRequest>(UPDATE_BID, [newStatus, id])
    await client.query(INSERT_HISTORY, [id, newStatus, uid])

    await client.query('COMMIT')

    console.log(`[bid-requests/update] ✅ ${id} → ${newStatus}`)
    return res.status(200).json({ bid: updated.rows[0] })
  } catch (error) {
    const err = error as Error
    try {
      await client.query('ROLLBACK')
    } catch (rollbackErr) {
      const rErr = rollbackErr as Error
      console.error('[bid-requests/update] rollback failed', rErr.message)
    }
    console.error('[bid-requests/update] ❌', err.message)
    return res.status(500).json({ error: 'Failed to update bid request' })
  } finally {
    client.release()
  }
}
