import { Router, RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { authMiddleware } from '../../middleware/auth.middleware'
import { createReportHandler } from './report.handler'
import { validate } from '../../middleware/validate'
import { createListingReportSchema } from '../../validation'

const router = Router()
const reportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS' },
})

router.post(
  '/:id/reports',
  reportRateLimit,
  authMiddleware,
  validate(createListingReportSchema),
  createReportHandler as unknown as RequestHandler
)

export default router
