'use strict'

import { Router } from 'express'
import syncEscrowsRoute from './sync-escrows.route'

const router = Router()
router.use('/', syncEscrowsRoute)

export default router
