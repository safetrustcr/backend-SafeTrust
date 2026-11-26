import { RequestHandler, Router } from 'express'
import { syncWalletHandler } from './sync-wallet.handler'
import { requireRole } from '../../middleware/require-role'

const router = Router()

router.post('/sync-wallet', requireRole(['guest', 'host', 'admin']), syncWalletHandler as RequestHandler)

export default router