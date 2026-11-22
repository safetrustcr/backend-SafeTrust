import { RequestHandler, Router } from 'express'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from './wallet-challenge.handler'
import { validate } from '../../middleware/validate'
import { createWalletChallengeSchema, verifyWalletChallengeSchema } from '../../validation'

const router = Router()

router.post('/challenge', validate(createWalletChallengeSchema), createWalletChallengeHandler as RequestHandler)
router.post('/verify', validate(verifyWalletChallengeSchema), verifyWalletChallengeHandler as RequestHandler)

export default router
