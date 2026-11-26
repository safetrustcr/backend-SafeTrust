'use strict'

import { Router, RequestHandler } from 'express'
import { createBidRequestHandler } from './create.handler'
import { validate } from '../../middleware/validate'
import { createBidRequestSchema } from '../../validation'
import { requireRole } from '../../middleware/require-role'

const router = Router()

router.post(
  '/',
  requireRole(['guest', 'host']),
  validate(createBidRequestSchema),
  createBidRequestHandler as unknown as RequestHandler
)

export default router
