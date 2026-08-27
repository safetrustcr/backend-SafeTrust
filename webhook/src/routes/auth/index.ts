import { Router } from 'express'
import syncWalletRoute from './sync-wallet.route'
import syncUserRoute from './sync-user.route'
import meRoute from './me.route'

const router = Router()

router.use('/', syncWalletRoute)
router.use('/', syncUserRoute)
router.use('/', meRoute)

export default router