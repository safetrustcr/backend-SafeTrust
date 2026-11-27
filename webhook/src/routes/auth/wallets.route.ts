import { RequestHandler, Router } from 'express'
import { listWalletsHandler, unlinkWalletHandler, setPrimaryWalletHandler } from './wallets.handler'
import { requireRole } from '../../middleware/require-role'

const router = Router()

router.get('/wallets', listWalletsHandler as RequestHandler)
router.delete('/wallets/:address', requireRole(['guest', 'host', 'admin']), unlinkWalletHandler as RequestHandler)
router.post('/wallets/:address/primary', requireRole(['guest', 'host', 'admin']), setPrimaryWalletHandler as RequestHandler)

export default router
