import { Router, RequestHandler } from 'express'
import { requireRole } from '../../middleware/require-role'
import { createReportHandler } from './report.handler'
import { validate } from '../../middleware/validate'
import { createListingReportSchema } from '../../validation'

const router = Router()

router.post(
  '/:id/reports',
  requireRole(['guest', 'host']),
  validate(createListingReportSchema),
  createReportHandler as unknown as RequestHandler
)

export default router
