'use strict'

import { RequestHandler, Router } from 'express'
import { confirmTransactionHandler } from './confirm-transaction.handler'
import { authMiddleware } from '../../middleware/auth.middleware'
import { requireRole } from '../../middleware/require-role'

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
  requireRole(['guest', 'host', 'admin']),
  confirmTransactionHandler
)

export default router
