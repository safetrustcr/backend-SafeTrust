import { Router } from 'express'
import { createReservationHandler } from './create.handler'
import { listReservationsHandler } from './list.handler'
import { getReservationHandler } from './get.handler'
import { cancelReservationHandler } from './cancel.handler'
import { validate } from '../../middleware/validate'
import { cancelReservationSchema, reservationListQuerySchema } from '../../validation'

const router: Router = Router()

// All routes under /api/reservations are authenticated upstream at the /api boundary
router.post('/', createReservationHandler)
router.get('/', validate(reservationListQuerySchema, 'query'), listReservationsHandler)
router.get('/:id', getReservationHandler)
router.post('/:id/cancel', validate(cancelReservationSchema), cancelReservationHandler)

export default router
