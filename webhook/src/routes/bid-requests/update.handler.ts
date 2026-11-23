'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import type { UpdateBidRequestBody } from '../../validation'
import { updateBidRequest, VALID_TRANSITIONS } from '../../services/bid-request.service'

export { VALID_TRANSITIONS } from '../../services/bid-request.service'

export type UpdateBidRequestPayload = UpdateBidRequestBody

export interface UpdateBidRequestParams {
  id: string
}

/**
 * PATCH /api/bid-requests/:id — owner updates bid status with history row.
 *
 * @param req - Authenticated request containing caller uid, path params (id), and body (status)
 * @param res - Express response
 * @returns JSON response with updated bid or error message
 */
export const updateBidRequestHandler = async (
  req: AuthenticatedRequest & { body: UpdateBidRequestBody },
  res: Response
): Promise<Response> => {
  const uid = req.context?.uid || req.user?.uid
  const { id } = req.params as { id: string }
  const { status: newStatus } = req.body

  try {
    const result = await updateBidRequest(uid, id, newStatus)
    switch (result.kind) {
      case 'profile-missing':
        return res.status(409).json({
          error: 'User profile not found',
          detail: 'Call POST /api/auth/sync-user before updating bid requests.',
        })
      case 'not-found':
        return res.status(404).json({ error: 'Bid not found' })
      case 'not-owner':
        return res.status(403).json({ error: 'Only owner can approve' })
      case 'invalid-transition':
        return res.status(400).json({
          error: 'Invalid transition',
          allowedTransitions: result.allowedTransitions,
        })
      case 'updated':
        logger.info('bid_requests.update.succeeded', { bidId: id, status: newStatus })
        return res.status(200).json({ bid: result.bid })
    }
  } catch (error) {
    const err = error as Error
    logger.error('bid_requests.update.failed', { error: err })
    return res.status(500).json({ error: 'Failed to update bid request' })
  }
}
