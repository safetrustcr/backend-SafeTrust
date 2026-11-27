import { RequestHandler, Router } from 'express'
import { syncWalletHandler } from './sync-wallet.handler'
import { validate } from '../../middleware/validate'
import { syncWalletSchema } from '../../validation'
import { requireRole } from '../../middleware/require-role'

const router = Router()

router.post(
  '/sync-wallet',
  requireRole(['guest', 'host', 'admin']),
  validate(syncWalletSchema),
  syncWalletHandler as RequestHandler
)

export default router