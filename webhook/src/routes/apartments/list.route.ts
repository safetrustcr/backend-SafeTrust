import { Router, RequestHandler } from 'express'
import { listApartments, createApartment, getApartmentById } from './list.handler'

const router: Router = Router()

// All routes under /api/apartments are authenticated upstream at the /api boundary
router.get('/', listApartments)
router.post('/', createApartment as RequestHandler)
router.get('/:id', getApartmentById)

export default router
