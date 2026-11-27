import { RequestHandler, Router } from 'express'
import { syncUserHandler } from './sync-user.handler'
import { requireRole } from '../../middleware/require-role'

const router = Router()

router.post('/sync-user', requireRole(['guest', 'host', 'admin']), syncUserHandler as RequestHandler)

export default router