import { RequestHandler, Router } from 'express'
import { syncUserHandler } from './sync-user.handler'
import { requireRole } from '../../middleware/require-role'
import { validate } from '../../middleware/validate'
import { emptyBodySchema } from '../../validation'

const router = Router()

router.post('/sync-user', requireRole(['guest', 'host', 'admin']), validate(emptyBodySchema), syncUserHandler as RequestHandler)

export default router