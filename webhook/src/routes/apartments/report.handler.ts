import { Response } from 'express'
import type { ListingReportResponse } from '@safetrust/types'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import type { CreateListingReportBody } from '../../validation'
import { createListingReport } from '../../services/listing-report.service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ReportErrorCode = 'INVALID_REPORT' | 'CANNOT_REPORT_OWN_LISTING'

type ReportResponse = ListingReportResponse | { error: string }

/**
 * POST /api/apartments/:id/reports
 * Reports a listing. Idempotent per (reporter, clientOpId); rate-limited per reporter.
 */
export const createReportHandler = async (
  req: AuthenticatedRequest & { body: CreateListingReportBody },
  res: Response<ReportResponse>
): Promise<Response<ReportResponse>> => {
  const reporterId = req.user?.uid
  if (!reporterId) return res.status(401).json({ error: 'Unauthorized' })

  const apartmentId = req.params.id
  if (typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    return res.status(400).json({ error: 'INVALID_REPORT' satisfies ReportErrorCode })
  }

  const { category, details, clientOpId } = req.body
  const normalizedDetails = details?.trim()

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
