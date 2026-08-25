'use strict'

import { Router, RequestHandler } from 'express'
import { updateBidRequestHandler } from './update.handler'

/** Express router for PATCH /api/bid-requests/:id (mounted under /api/bid-requests). */
const router = Router()

router.patch('/:id', updateBidRequestHandler as unknown as RequestHandler)

export default router
