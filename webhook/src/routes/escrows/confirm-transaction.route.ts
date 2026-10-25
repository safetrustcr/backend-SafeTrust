'use strict'

import { Router } from 'express'
import { confirmTransactionHandler } from './confirm-transaction.handler'

const router = Router()

/**
 * POST /api/escrows/confirm-transaction
 * Dual-path confirmation endpoint for Stellar transactions:
 *  - Helper submission (Path A)
 *  - External submission & TW indexer sync (Path B)
 */
router.post('/api/escrows/confirm-transaction', confirmTransactionHandler)

export default router
