'use strict'

import { Router, RequestHandler } from 'express'
import { updateBidRequestHandler } from './update.handler'
import { validate } from '../../middleware/validate'
import { updateBidRequestSchema } from '../../validation'
import { requireRole } from '../../middleware/require-role'

/** Express router for PATCH /api/bid-requests/:id (mounted under /api/bid-requests). */
const router = Router()

router.patch(
  '/:id',
  requireRole(['host', 'admin']),
  validate(updateBidRequestSchema),
  updateBidRequestHandler as unknown as RequestHandler
)

export default router
