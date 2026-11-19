'use strict'

import { Router, RequestHandler } from 'express'
import { createClaimHandler } from './create.handler'
import { listClaimsHandler } from './list.handler'

/** Express router for /api/escrow-claims/:escrowId (mounted behind authMiddleware). */
const router = Router()

router.post('/:escrowId', createClaimHandler as unknown as RequestHandler)
router.get('/:escrowId', listClaimsHandler as unknown as RequestHandler)

export default router
