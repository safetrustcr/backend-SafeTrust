'use strict'

import { Router, RequestHandler } from 'express'
import { updateBidRequestHandler } from './update.handler'
import { validate } from '../../middleware/validate'
import { updateBidRequestSchema } from '../../validation'

/** Express router for PATCH /api/bid-requests/:id (mounted under /api/bid-requests). */
const router = Router()

router.patch('/:id', validate(updateBidRequestSchema), updateBidRequestHandler as unknown as RequestHandler)

export default router
