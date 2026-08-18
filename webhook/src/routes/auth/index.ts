import { Router } from 'express'
import meRoute from './me.route'
import syncUserRoute from './sync-user.route'
import syncWalletRoute from './sync-wallet.route'

const router = Router()
router.use('/', meRoute)
router.use('/', syncUserRoute)
router.use('/', syncWalletRoute)

export default router
