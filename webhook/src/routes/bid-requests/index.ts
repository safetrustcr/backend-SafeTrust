'use strict'

import { Router } from 'express'
import updateRoute from './update.route'
import createRoute from './create.route'

const router = Router()

router.use('/', updateRoute)
router.use('/', createRoute)

export default router
