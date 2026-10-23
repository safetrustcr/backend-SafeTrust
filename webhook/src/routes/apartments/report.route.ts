import { Router, RequestHandler } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReportHandler } from './report.handler'

const router = Router()

router.post('/:id/reports', authMiddleware, createReportHandler as unknown as RequestHandler)

export default router
