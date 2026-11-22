import { Router, RequestHandler } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReportHandler } from './report.handler'
import { validate } from '../../middleware/validate'
import { createListingReportSchema } from '../../validation'

const router = Router()

router.post(
  '/:id/reports',
  authMiddleware,
  validate(createListingReportSchema),
  createReportHandler as unknown as RequestHandler
)

export default router
