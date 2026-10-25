import { RequestHandler, Router } from 'express'
import { syncWalletHandler } from './sync-wallet.handler'

const router = Router()

router.post('/sync-wallet', syncWalletHandler as RequestHandler)

export default router