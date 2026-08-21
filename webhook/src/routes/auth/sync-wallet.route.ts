import { Router, RequestHandler } from 'express'
import { syncWalletHandler } from './sync-wallet.handler'

const router = Router()
router.post('/sync-wallet', syncWalletHandler as unknown as RequestHandler)

export default router
