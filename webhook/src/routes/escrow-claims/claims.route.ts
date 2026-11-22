'use strict'

import { Router, RequestHandler } from 'express'
import { createClaimHandler } from './create.handler'
import { listClaimsHandler } from './list.handler'
import { validate } from '../../middleware/validate'
import { createEscrowClaimSchema } from '../../validation'

/** Express router for /api/escrow-claims/:escrowId (mounted behind authMiddleware). */
const router = Router()

router.post('/:escrowId', validate(createEscrowClaimSchema), createClaimHandler as unknown as RequestHandler)
router.get('/:escrowId', listClaimsHandler as unknown as RequestHandler)

export default router
