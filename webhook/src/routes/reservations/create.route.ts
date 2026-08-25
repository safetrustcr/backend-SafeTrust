import { Router } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReservationHandler } from './create.handler'

const router = Router()

// authMiddleware required — guest must be authenticated to book
router.post('/', authMiddleware, createReservationHandler)
router.post('/api/reservations', authMiddleware, createReservationHandler)

export default router
