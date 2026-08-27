import { RequestHandler, Router } from 'express'
import { syncUserHandler } from './sync-user.handler'

const router = Router()

router.post('/sync-user', syncUserHandler as RequestHandler)

export default router