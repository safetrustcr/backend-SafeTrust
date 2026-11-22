import { Router, RequestHandler } from 'express'
import { listApartments, createApartment, getApartmentById } from './list.handler'
import { validate } from '../../middleware/validate'
import { apartmentListQuerySchema, createApartmentSchema } from '../../validation'

const router: Router = Router()

// All routes under /api/apartments are authenticated upstream at the /api boundary
router.get('/', validate(apartmentListQuerySchema, 'query'), listApartments)
router.post('/', validate(createApartmentSchema), createApartment as RequestHandler)
router.get('/:id', getApartmentById)

export default router
