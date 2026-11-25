'use strict'

import { RequestHandler, Router } from 'express'
import { confirmTransactionHandler } from './confirm-transaction.handler'
import { authMiddleware } from '../../middleware/auth.middleware'

const router = Router()

/**
 * POST /api/escrows/confirm-transaction
 * Dual-path confirmation endpoint for Stellar transactions:
 *  - Helper submission (Path A)
 *  - External submission & TW indexer sync (Path B)
 */
router.post(
  '/api/escrows/confirm-transaction',
  authMiddleware as unknown as RequestHandler,
  confirmTransactionHandler
)

export default router
