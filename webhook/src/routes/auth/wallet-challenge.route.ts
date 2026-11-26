import { RequestHandler, Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from './wallet-challenge.handler'
import { validate } from '../../middleware/validate'
import { createWalletChallengeSchema, verifyWalletChallengeSchema } from '../../validation'

const router = Router()
const walletChallengeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS' },
})

router.post(
  '/challenge',
  walletChallengeRateLimit,
  validate(createWalletChallengeSchema),
  createWalletChallengeHandler as RequestHandler
)
router.post(
  '/verify',
  walletChallengeRateLimit,
  validate(verifyWalletChallengeSchema),
  verifyWalletChallengeHandler as RequestHandler
)

export default router
