import { RequestHandler, Router } from 'express'
import { hasuraClaimsEventGuard } from './sync-claims.guard'
import { syncClaimsEventHandler } from './sync-claims.handler'

const router = Router()

router.post('/sync-claims', hasuraClaimsEventGuard, syncClaimsEventHandler as unknown as RequestHandler)

export default router
