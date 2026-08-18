import { Router, RequestHandler } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { meHandler } from './me.handler'

const router = Router()

router.get('/me', authMiddleware as unknown as RequestHandler, meHandler as unknown as RequestHandler)
router.get('/api/auth/me', authMiddleware as unknown as RequestHandler, meHandler as unknown as RequestHandler)

export default router
