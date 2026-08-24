import { Router, RequestHandler } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReservationHandler } from './create.handler'

const router = Router()

// authMiddleware required — guest must be authenticated to book
router.post('/', authMiddleware as unknown as RequestHandler, createReservationHandler as unknown as RequestHandler)
router.post('/api/reservations', authMiddleware as unknown as RequestHandler, createReservationHandler as unknown as RequestHandler)

export default router
