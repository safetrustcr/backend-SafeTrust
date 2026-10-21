import { Router } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReservationHandler } from './create.handler'

const router: Router = Router()

// authMiddleware required — guest must be authenticated to book
router.post('/', authMiddleware, createReservationHandler)

export default router
