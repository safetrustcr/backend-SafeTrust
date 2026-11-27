'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { updateBidRequest, VALID_TRANSITIONS } from '../../services/bid-request.service'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors'

export { VALID_TRANSITIONS } from '../../services/bid-request.service'

export interface UpdateBidRequestPayload {
  status?: string
}

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
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const uid = req.context?.uid || req.user?.uid
  const { id } = req.params as { id: string }
  const { status: newStatus } = (req.body || {}) as UpdateBidRequestPayload

  if (!newStatus) {
    throw new ValidationError('Missing required field: status')
  }

  const result = await updateBidRequest(uid, id, newStatus)
  switch (result.kind) {
    case 'profile-missing':
      throw new ConflictError('User profile not found', {
        code: 'profile_missing',
      })
    case 'not-found':
      throw new NotFoundError('Bid not found')
    case 'not-owner':
      throw new ForbiddenError('Only owner can approve')
    case 'invalid-transition':
      throw new ValidationError('Invalid transition', {
        code: 'invalid_transition',
        details: { allowedTransitions: result.allowedTransitions },
      })
    case 'updated':
      logger.info('bid_requests.update.succeeded', { bidId: id, status: newStatus })
      return res.status(200).json({ bid: result.bid })
  }
}
