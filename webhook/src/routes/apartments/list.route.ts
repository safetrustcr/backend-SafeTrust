import { Router, RequestHandler } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { listApartments, createApartment, getApartmentById } from './list.handler'

const router = Router()

router.get('/', authMiddleware as unknown as RequestHandler, listApartments as unknown as RequestHandler)
router.post('/', authMiddleware as unknown as RequestHandler, createApartment as unknown as RequestHandler)
router.get('/:id', authMiddleware as unknown as RequestHandler, getApartmentById as unknown as RequestHandler)

export default router
