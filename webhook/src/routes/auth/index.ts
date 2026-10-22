import { Router } from 'express'
import syncWalletRoute from './sync-wallet.route'
import syncUserRoute from './sync-user.route'
import meRoute from './me.route'
import walletChallengeRoute from './wallet-challenge.route'
import walletsRoute from './wallets.route'

const router = Router()

router.use('/', syncWalletRoute)
router.use('/wallet', walletChallengeRoute)
router.use('/', walletsRoute)
router.use('/', syncUserRoute)
router.use('/', meRoute)

export default router
