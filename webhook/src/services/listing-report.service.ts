import type { ReportCategory } from '../domain'
import {
  countListingReports,
  findListingReportApartment,
  findListingReportByOpId,
  insertListingReport,
  ListingReportRow,
} from '../repositories/apartment.repository'

export type CreateListingReportResult =
  | { kind: 'not-found' }
  | { kind: 'own-listing' }
  | { kind: 'rate-limited' }
  | { kind: 'operation-reused' }
  | { kind: 'missing-after-conflict' }
  | { kind: 'created'; report: ListingReportRow }

export async function createListingReport(input: {
  apartmentId: string
  reporterId: string
  category: ReportCategory
  details: string | null
  clientOpId: string
}): Promise<CreateListingReportResult> {
  const apartment = await findListingReportApartment(input.apartmentId)
  if (!apartment) return { kind: 'not-found' }
  if (apartment.owner_id === input.reporterId) return { kind: 'own-listing' }
  if (await countListingReports(input.reporterId) >= 10) return { kind: 'rate-limited' }

  const inserted = await insertListingReport(input)
  if (inserted) return { kind: 'created', report: inserted }

  const existing = await findListingReportByOpId(input.reporterId, input.clientOpId)
  if (!existing) return { kind: 'missing-after-conflict' }
  if (existing.apartment_id !== input.apartmentId) return { kind: 'operation-reused' }
  return { kind: 'created', report: existing }
}
