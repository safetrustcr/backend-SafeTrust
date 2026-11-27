import { Response } from 'express'
import type { CreateListingReportPayload, ListingReportResponse, ReportCategory } from '@safetrust/types'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { createListingReport } from '../../services/listing-report.service'
import {
  AppError,
  AuthError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
} from '../../utils/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REPORT_CATEGORIES: ReportCategory[] = [
  'inaccurate',
  'scam_or_fraud',
  'offensive',
  'safety',
  'duplicate',
  'other',
]

const MAX_DETAILS_LENGTH = 1000
const MIN_OTHER_DETAILS_LENGTH = 10

type ReportErrorCode = 'INVALID_REPORT' | 'CANNOT_REPORT_OWN_LISTING'

type ReportResponse = ListingReportResponse | { error: string }

/**
 * POST /api/apartments/:id/reports
 * Reports a listing. Idempotent per (reporter, clientOpId); rate-limited per reporter.
 */
export const createReportHandler = async (
  req: AuthenticatedRequest,
  res: Response<ReportResponse>
): Promise<Response<ReportResponse>> => {
  const reporterId = req.user?.uid
  if (!reporterId) throw new AuthError('Unauthorized')

  const apartmentId = req.params.id
  if (typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    throw new ValidationError('INVALID_REPORT', { code: 'invalid_report' })
  }

  const { category, details, clientOpId } = (req.body || {}) as Partial<CreateListingReportPayload>

  if (!category || !REPORT_CATEGORIES.includes(category)) {
    throw new ValidationError('INVALID_REPORT', { code: 'invalid_report' })
  }

  const normalizedDetails = typeof details === 'string' ? details.trim() : undefined
  if (normalizedDetails && normalizedDetails.length > MAX_DETAILS_LENGTH) {
    throw new ValidationError('INVALID_REPORT', { code: 'invalid_report' })
  }
  if (category === 'other' && (!normalizedDetails || normalizedDetails.length < MIN_OTHER_DETAILS_LENGTH)) {
    throw new ValidationError('INVALID_REPORT', { code: 'invalid_report' })
  }

  if (typeof clientOpId !== 'string' || !UUID_RE.test(clientOpId)) {
    throw new ValidationError('INVALID_REPORT', { code: 'invalid_report' })
  }

  const result = await createListingReport({
    apartmentId,
    reporterId,
    category,
    details: normalizedDetails || null,
    clientOpId,
  })
  if (result.kind === 'not-found') throw new NotFoundError('Apartment not found')
  if (result.kind === 'own-listing') {
    throw new ValidationError('CANNOT_REPORT_OWN_LISTING', { code: 'cannot_report_own_listing' })
  }
  if (result.kind === 'rate-limited') {
    throw new TooManyRequestsError('Too many reports. Try again later.')
  }
  if (result.kind === 'operation-reused') throw new ConflictError('INVALID_REPORT', { code: 'invalid_report' })
  if (result.kind === 'missing-after-conflict') {
    throw new AppError('Failed to create report', 500)
  }

  // Never log `details` — it may contain personal data.
  logger.info('apartments.report.created', {
    reportId: result.report.id,
    apartmentId,
    category,
  })

  return res.status(201).json({ id: result.report.id, status: result.report.status })
}

export default { createReportHandler }
