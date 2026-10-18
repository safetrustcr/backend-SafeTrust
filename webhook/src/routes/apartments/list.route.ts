import { Router, RequestHandler } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { listApartments, createApartment, getApartmentById } from './list.handler'

const router = Router()

router.get('/', authMiddleware, listApartments)
router.post('/', authMiddleware, createApartment as RequestHandler)
router.get('/:id', authMiddleware, getApartmentById)

export default router
