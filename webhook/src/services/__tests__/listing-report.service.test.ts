import {
  countListingReports,
  findListingReportApartment,
  findListingReportByOpId,
  insertListingReport,
} from '../../repositories/apartment.repository'
import { createListingReport } from '../listing-report.service'

jest.mock('../../repositories/apartment.repository', () => ({
  countListingReports: jest.fn(),
  findListingReportApartment: jest.fn(),
  findListingReportByOpId: jest.fn(),
  insertListingReport: jest.fn(),
}))

const input = {
  apartmentId: 'apartment-1',
  reporterId: 'reporter-1',
  category: 'safety' as const,
  details: null,
  clientOpId: 'operation-1',
}
const report = { id: 'report-1', status: 'open', apartment_id: 'apartment-1' }

describe('createListingReport service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(findListingReportApartment as jest.Mock).mockResolvedValue({
      id: 'apartment-1', owner_id: 'owner-1',
    })
    ;(countListingReports as jest.Mock).mockResolvedValue(0)
    ;(insertListingReport as jest.Mock).mockResolvedValue(report)
  })

  it('creates a report only after the ownership and rate checks', async () => {
    await expect(createListingReport(input)).resolves.toEqual({ kind: 'created', report })
    expect(findListingReportApartment).toHaveBeenCalledWith('apartment-1')
    expect(countListingReports).toHaveBeenCalledWith('reporter-1')
    expect(insertListingReport).toHaveBeenCalledWith(input)
  })

  it('returns an existing report for an idempotent retry and detects reused ids', async () => {
    ;(insertListingReport as jest.Mock).mockResolvedValue(null)
    ;(findListingReportByOpId as jest.Mock).mockResolvedValue(report)
    await expect(createListingReport(input)).resolves.toEqual({ kind: 'created', report })

    ;(findListingReportByOpId as jest.Mock).mockResolvedValue({
      ...report, apartment_id: 'other-apartment',
    })
    await expect(createListingReport(input)).resolves.toEqual({ kind: 'operation-reused' })
  })

  it('short-circuits reports for missing/owned listings and rate-limited reporters', async () => {
    ;(findListingReportApartment as jest.Mock).mockResolvedValue(null)
    await expect(createListingReport(input)).resolves.toEqual({ kind: 'not-found' })

    ;(findListingReportApartment as jest.Mock).mockResolvedValue({
      id: 'apartment-1', owner_id: 'reporter-1',
    })
    await expect(createListingReport(input)).resolves.toEqual({ kind: 'own-listing' })

    ;(findListingReportApartment as jest.Mock).mockResolvedValue({
      id: 'apartment-1', owner_id: 'owner-1',
    })
    ;(countListingReports as jest.Mock).mockResolvedValue(10)
    await expect(createListingReport(input)).resolves.toEqual({ kind: 'rate-limited' })
    expect(insertListingReport).not.toHaveBeenCalled()
  })
})
