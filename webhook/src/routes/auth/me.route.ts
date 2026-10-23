import { RequestHandler, Router } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { meHandler } from './me.handler'

const router = Router()

router.get('/me', authMiddleware, meHandler as RequestHandler)

export default router