import { Router } from 'express'
import { createReservationHandler } from './create.handler'
import { listReservationsHandler } from './list.handler'
import { getReservationHandler } from './get.handler'
import { cancelReservationHandler } from './cancel.handler'

const router: Router = Router()

// All routes under /api/reservations are authenticated upstream at the /api boundary
router.post('/', createReservationHandler)
router.get('/', listReservationsHandler)
router.get('/:id', getReservationHandler)
router.post('/:id/cancel', cancelReservationHandler)

export default router
