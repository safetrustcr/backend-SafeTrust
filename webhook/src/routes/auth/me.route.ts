import { RequestHandler, Router } from 'express'
import { meHandler } from './me.handler'

const router: Router = Router()

// Authenticated upstream at the /api boundary
router.get('/me', meHandler as RequestHandler)

export default router