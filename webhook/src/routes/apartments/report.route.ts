import { Router, RequestHandler } from 'express'
import { requireRole } from '../../middleware/require-role'
import { createReportHandler } from './report.handler'

const router = Router()

router.post('/:id/reports', requireRole(['guest', 'host']), createReportHandler as unknown as RequestHandler)

export default router
