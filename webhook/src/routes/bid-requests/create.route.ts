'use strict'

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { createBidRequestHandler, isValidCalendarDate } from './create.handler'
import { requireRole } from '../../middleware/require-role'
import { ValidationError } from '../../utils/errors'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Middleware that validates the incoming bid request payload fields before passing to the handler.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function validateCreateBidRequest(req: Request, res: Response, next: NextFunction): void {
  const apartmentId = req.body?.apartmentId || req.body?.apartment_id
  const proposedPrice = req.body?.proposedPrice || req.body?.proposed_price
  const desiredMoveIn = req.body?.desiredMoveIn || req.body?.desired_move_in

  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    throw new ValidationError('Missing required fields')
  }
  if (typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    throw new ValidationError('apartmentId must be a valid UUID')
  }
  if (typeof proposedPrice !== 'number' && typeof proposedPrice !== 'string') {
    throw new ValidationError('proposedPrice must be a positive number')
  }
  const price = Number(proposedPrice)
  if (!Number.isFinite(price) || price <= 0) {
    throw new ValidationError('proposedPrice must be a positive number')
  }
  if (typeof desiredMoveIn !== 'string' || !isValidCalendarDate(desiredMoveIn)) {
    throw new ValidationError('desiredMoveIn must be a valid date')
  }
  next()
}

router.post('/', requireRole(['guest', 'host']), validateCreateBidRequest, createBidRequestHandler as unknown as RequestHandler)

export default router
