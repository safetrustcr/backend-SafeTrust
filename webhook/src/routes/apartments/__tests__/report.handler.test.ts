import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createReportHandler } from '../report.handler'
import { createListingReport as reportService } from '../../../services/listing-report.service'

jest.mock('../../../services/listing-report.service', () => ({ createListingReport: jest.fn() }))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

const APARTMENT_ID = '11111111-1111-1111-1111-111111111111'
const CLIENT_OP_ID = '22222222-2222-2222-2222-222222222222'
const REPORTER_ID = 'reporter-1'

function makeRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    user: { uid: REPORTER_ID, role: 'guest' },
    params: { id: APARTMENT_ID },
    body: { category: 'scam_or_fraud', clientOpId: CLIENT_OP_ID },
    ...overrides,
  } as AuthenticatedRequest
}

describe('apartments/report.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(reportService as jest.Mock).mockResolvedValue({
      kind: 'created',
      report: { id: 'report-1', status: 'open', apartment_id: APARTMENT_ID },
    })
  })

  it('returns 401 when unauthorized (no user on request)', async () => {
    const req = makeRequest({ user: undefined })
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 400 INVALID_REPORT for a malformed apartment id', async () => {
    const req = makeRequest({ params: { id: 'not-a-uuid' } })
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_REPORT' })
    expect(reportService).not.toHaveBeenCalled()
  })

  it('returns 404 when the apartment does not exist or is deleted', async () => {
    ;(reportService as jest.Mock).mockResolvedValueOnce({ kind: 'not-found' })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Apartment not found' })
  })

  it("returns 400 CANNOT_REPORT_OWN_LISTING when the reporter owns the apartment", async () => {
    ;(reportService as jest.Mock).mockResolvedValueOnce({ kind: 'own-listing' })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'CANNOT_REPORT_OWN_LISTING' })
  })

  it('returns 429 when the reporter has hit the rate limit', async () => {
    ;(reportService as jest.Mock).mockResolvedValueOnce({ kind: 'rate-limited' })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(429)
  })

  it('creates a report and returns 201 { id, status }', async () => {
    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 'report-1', status: 'open' })
  })

  it('is idempotent — the same clientOpId returns the existing report on conflict', async () => {
    ;(reportService as jest.Mock).mockResolvedValueOnce({
      kind: 'created',
      report: { id: 'report-existing', status: 'open', apartment_id: APARTMENT_ID },
    })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 'report-existing', status: 'open' })
  })

  it('returns 409 when a client operation id is reused for another apartment', async () => {
    ;(reportService as jest.Mock).mockResolvedValueOnce({ kind: 'operation-reused' })
    const res = makeResponse()
    await createReportHandler(makeRequest(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_REPORT' })
  })

  it('returns 500 when an idempotency conflict cannot be resolved', async () => {
    ;(reportService as jest.Mock).mockResolvedValueOnce({ kind: 'missing-after-conflict' })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create report' })
  })

  it('never logs the details field', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const secretDetails = 'personal data goes here'
    const req = makeRequest({ body: { category: 'safety', details: secretDetails, clientOpId: CLIENT_OP_ID } })
    const res = makeResponse()

    await createReportHandler(req, res)

    const loggedOutput = logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(loggedOutput).not.toContain(secretDetails)
    logSpy.mockRestore()
  })
})
