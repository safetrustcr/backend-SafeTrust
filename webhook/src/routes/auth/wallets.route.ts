import { RequestHandler, Router } from 'express'
import { listWalletsHandler, unlinkWalletHandler, setPrimaryWalletHandler } from './wallets.handler'

const router = Router()

router.get('/wallets', listWalletsHandler as RequestHandler)
router.delete('/wallets/:address', unlinkWalletHandler as RequestHandler)
router.post('/wallets/:address/primary', setPrimaryWalletHandler as RequestHandler)

export default router
