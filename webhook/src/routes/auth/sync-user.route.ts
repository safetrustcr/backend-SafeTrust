import { RequestHandler, Router } from 'express'
import { syncUserHandler } from './sync-user.handler'
import { validate } from '../../middleware/validate'
import { emptyBodySchema } from '../../validation'

const router = Router()

router.post('/sync-user', validate(emptyBodySchema), syncUserHandler as RequestHandler)

export default router