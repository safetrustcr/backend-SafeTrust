import { RequestHandler, Router } from 'express'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from './wallet-challenge.handler'

const router = Router()

router.post('/challenge', createWalletChallengeHandler as RequestHandler)
router.post('/verify', verifyWalletChallengeHandler as RequestHandler)

export default router
