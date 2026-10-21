import { Router } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReservationHandler } from './create.handler'
import { listReservationsHandler } from './list.handler'
import { getReservationHandler } from './get.handler'
import { cancelReservationHandler } from './cancel.handler'

const router: Router = Router()

router.post('/', authMiddleware, createReservationHandler)
router.get('/', authMiddleware, listReservationsHandler)
router.get('/:id', authMiddleware, getReservationHandler)
router.post('/:id/cancel', authMiddleware, cancelReservationHandler)

export default router
