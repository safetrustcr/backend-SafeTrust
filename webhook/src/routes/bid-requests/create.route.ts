'use strict'

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { createBidRequestHandler } from './create.handler'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateCreateBidRequest(req: Request, res: Response, next: NextFunction): void {
  const apartmentId = req.body?.apartmentId || req.body?.apartment_id
  const proposedPrice = req.body?.proposedPrice || req.body?.proposed_price
  const desiredMoveIn = req.body?.desiredMoveIn || req.body?.desired_move_in

  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    res.status(400).json({ error: 'Missing required fields' })
    return
  }
  if (typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    res.status(400).json({ error: 'apartmentId must be a valid UUID' })
    return
  }
  if (typeof proposedPrice !== 'number' && typeof proposedPrice !== 'string') {
    res.status(400).json({ error: 'proposedPrice must be a positive number' })
    return
  }
  const price = Number(proposedPrice)
  if (!Number.isFinite(price) || price <= 0) {
    res.status(400).json({ error: 'proposedPrice must be a positive number' })
    return
  }
  if (isNaN(new Date(desiredMoveIn).getTime())) {
    res.status(400).json({ error: 'desiredMoveIn must be a valid date' })
    return
  }
  next()
}

router.post('/', validateCreateBidRequest, createBidRequestHandler as unknown as RequestHandler)

export default router
