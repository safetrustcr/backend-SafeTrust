import { RequestHandler, Router } from 'express'
import { syncWalletHandler } from './sync-wallet.handler'
import { validate } from '../../middleware/validate'
import { syncWalletSchema } from '../../validation'

const router = Router()

router.post('/sync-wallet', validate(syncWalletSchema), syncWalletHandler as RequestHandler)

export default router