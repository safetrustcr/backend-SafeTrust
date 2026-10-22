import { Router } from 'express'
import { createReservationHandler } from './create.handler'

const router: Router = Router()

// All routes under /api/reservations are authenticated upstream at the /api boundary
router.post('/', createReservationHandler)

export default router
