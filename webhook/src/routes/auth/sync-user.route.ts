import { Router, RequestHandler } from 'express'
import { syncUserHandler } from './sync-user.handler'

const router = Router()
router.post('/sync-user', syncUserHandler as unknown as RequestHandler)

export default router
