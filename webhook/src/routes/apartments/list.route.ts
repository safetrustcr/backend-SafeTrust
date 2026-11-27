import { Router, RequestHandler } from 'express'
import { listApartments, createApartment, getApartmentById } from './list.handler'
import { requireRole } from '../../middleware/require-role'

const router: Router = Router()

// All routes under /api/apartments are authenticated upstream at the /api boundary
router.get('/', listApartments)
router.post('/', requireRole(['host', 'admin']), createApartment as RequestHandler)
router.get('/:id', getApartmentById)

export default router
