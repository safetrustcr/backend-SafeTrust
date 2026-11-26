import { RequestHandler, Router } from 'express'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from './wallet-challenge.handler'
import { requireRole } from '../../middleware/require-role'

const router = Router()

router.post('/challenge', requireRole(['guest', 'host', 'admin']), createWalletChallengeHandler as RequestHandler)
router.post('/verify', requireRole(['guest', 'host', 'admin']), verifyWalletChallengeHandler as RequestHandler)

export default router
