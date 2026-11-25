import { Response } from 'express'
import type { CreateListingReportPayload, ListingReportResponse, ReportCategory } from '../../domain'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { createListingReport } from '../../services/listing-report.service'

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
  if (!reporterId) return res.status(401).json({ error: 'Unauthorized' })

  const apartmentId = req.params.id
  if (typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    return res.status(400).json({ error: 'INVALID_REPORT' satisfies ReportErrorCode })
  }

  const { category, details, clientOpId } = (req.body || {}) as Partial<CreateListingReportPayload>

  if (!category || !REPORT_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'INVALID_REPORT' satisfies ReportErrorCode })
  }

  const normalizedDetails = typeof details === 'string' ? details.trim() : undefined
  if (normalizedDetails && normalizedDetails.length > MAX_DETAILS_LENGTH) {
    return res.status(400).json({ error: 'INVALID_REPORT' satisfies ReportErrorCode })
  }
  if (category === 'other' && (!normalizedDetails || normalizedDetails.length < MIN_OTHER_DETAILS_LENGTH)) {
    return res.status(400).json({ error: 'INVALID_REPORT' satisfies ReportErrorCode })
  }

  if (typeof clientOpId !== 'string' || !UUID_RE.test(clientOpId)) {
    return res.status(400).json({ error: 'INVALID_REPORT' satisfies ReportErrorCode })
  }

  try {
    const result = await createListingReport({
      apartmentId,
      reporterId,
      category,
      details: normalizedDetails || null,
      clientOpId,
    })
    if (result.kind === 'not-found') return res.status(404).json({ error: 'Apartment not found' })
    if (result.kind === 'own-listing') {
      return res.status(400).json({ error: 'CANNOT_REPORT_OWN_LISTING' satisfies ReportErrorCode })
    }
    if (result.kind === 'rate-limited') {
      return res.status(429).json({ error: 'Too many reports. Try again later.' })
    }
    if (result.kind === 'operation-reused') return res.status(409).json({ error: 'INVALID_REPORT' })
    if (result.kind === 'missing-after-conflict') {
      return res.status(500).json({ error: 'Failed to create report' })
    }

    // Never log `details` — it may contain personal data.
    logger.info('apartments.report.created', {
      reportId: result.report.id,
      apartmentId,
      category,
    })

    return res.status(201).json({ id: result.report.id, status: result.report.status })
  } catch (error) {
    const err = error as Error
    logger.error('apartments.report.failed', { error: err })
    return res.status(500).json({ error: 'Failed to create report' })
  }
}

export default { createReportHandler }
