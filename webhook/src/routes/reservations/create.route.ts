import { Router } from 'express'
import { createReservationHandler } from './create.handler'
import { requireRole } from '../../middleware/require-role'
import { validate } from '../../middleware/validate'
import { createReservationSchema } from '../../validation'

const router: Router = Router()

// All routes under /api/reservations are authenticated upstream at the /api boundary
router.post('/', requireRole(['guest', 'host']), validate(createReservationSchema), createReservationHandler)

export default router
