import { Response } from 'express'
import type { CreateListingReportPayload, ListingReportResponse, ReportCategory } from '@safetrust/types'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { query } from '../../services/db'

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
const RATE_LIMIT_MAX_REPORTS = 10
const RATE_LIMIT_WINDOW = '24 hours'

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
  if (!UUID_RE.test(apartmentId)) {
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
    const apartmentResult = await query<{ id: string; owner_id: string | null }>(
      'SELECT id, owner_id FROM safetrust.apartments WHERE id = $1 AND deleted_at IS NULL',
      [apartmentId]
    )
    const apartment = apartmentResult.rows[0]
    if (!apartment) {
      return res.status(404).json({ error: 'Apartment not found' })
    }

    if (apartment.owner_id === reporterId) {
      return res.status(400).json({ error: 'CANNOT_REPORT_OWN_LISTING' satisfies ReportErrorCode })
    }

    const rateLimitResult = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM safetrust.listing_reports
       WHERE reporter_id = $1 AND created_at > NOW() - $2::interval`,
      [reporterId, RATE_LIMIT_WINDOW]
    )
    if (parseInt(rateLimitResult.rows[0].count, 10) >= RATE_LIMIT_MAX_REPORTS) {
      return res.status(429).json({ error: 'Too many reports. Try again later.' })
    }

    const insertResult = await query<{ id: string; status: string }>(
      `INSERT INTO safetrust.listing_reports (apartment_id, reporter_id, category, details, client_op_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reporter_id, client_op_id) DO NOTHING
       RETURNING id, status`,
      [apartmentId, reporterId, category, normalizedDetails || null, clientOpId]
    )

    let report = insertResult.rows[0]
    if (!report) {
      const existing = await query<{ id: string; status: string }>(
        'SELECT id, status, apartment_id FROM safetrust.listing_reports WHERE reporter_id = $1 AND client_op_id = $2',
        [reporterId, clientOpId]
      )
      report = existing.rows[0]
      if (!report) {
        return res.status(500).json({ error: 'Failed to create report' })
      }
      if ((report as { apartment_id?: string }).apartment_id !== apartmentId) {
        return res.status(409).json({ error: 'INVALID_REPORT' })
      }
    }

    // Never log `details` — it may contain personal data.
    console.log(`[apartments/report] ✅ report created — id: ${report.id}, apartmentId: ${apartmentId}, category: ${category}`)

    return res.status(201).json({ id: report.id, status: report.status })
  } catch (error) {
    const err = error as Error
    console.error('[apartments/report] ❌', err.message)
    return res.status(500).json({ error: 'Failed to create report' })
  }
}

export default { createReportHandler }
