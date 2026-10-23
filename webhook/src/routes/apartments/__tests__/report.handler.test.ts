import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createReportHandler } from '../report.handler'
import { query } from '../../../services/db'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
  default: {
    query: jest.fn(),
  },
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

const APARTMENT_ID = '11111111-1111-1111-1111-111111111111'
const CLIENT_OP_ID = '22222222-2222-2222-2222-222222222222'
const REPORTER_ID = 'reporter-1'
const OWNER_ID = 'owner-1'

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
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 INVALID_REPORT for an unknown category', async () => {
    const req = makeRequest({ body: { category: 'not_a_category', clientOpId: CLIENT_OP_ID } })
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_REPORT' })
  })

  it('returns 400 INVALID_REPORT when details exceed 1000 characters', async () => {
    const req = makeRequest({
      body: { category: 'inaccurate', details: 'x'.repeat(1001), clientOpId: CLIENT_OP_ID },
    })
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_REPORT' })
  })

  it("returns 400 INVALID_REPORT when category is 'other' without enough details", async () => {
    const req = makeRequest({ body: { category: 'other', details: 'too short', clientOpId: CLIENT_OP_ID } })
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_REPORT' })
  })

  it('returns 400 INVALID_REPORT when clientOpId is not a valid uuid', async () => {
    const req = makeRequest({ body: { category: 'inaccurate', clientOpId: 'nope' } })
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_REPORT' })
  })

  it('returns 404 when the apartment does not exist or is deleted', async () => {
    ;(query as jest.Mock).mockResolvedValueOnce({ rows: [] })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Apartment not found' })
  })

  it("returns 400 CANNOT_REPORT_OWN_LISTING when the reporter owns the apartment", async () => {
    ;(query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: APARTMENT_ID, owner_id: REPORTER_ID }] })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'CANNOT_REPORT_OWN_LISTING' })
  })

  it('returns 429 when the reporter has hit the rate limit', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: APARTMENT_ID, owner_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [{ count: '10' }] })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(429)
  })

  it('creates a report and returns 201 { id, status }', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: APARTMENT_ID, owner_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'report-1', status: 'open' }] })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 'report-1', status: 'open' })
  })

  it('is idempotent — the same clientOpId returns the existing report on conflict', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: APARTMENT_ID, owner_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] }) // ON CONFLICT DO NOTHING -> no row returned
      .mockResolvedValueOnce({ rows: [{ id: 'report-existing', status: 'open' }] })

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 'report-existing', status: 'open' })
  })

  it('returns 500 when the database throws', async () => {
    ;(query as jest.Mock).mockRejectedValueOnce(new Error('DB failure'))

    const req = makeRequest()
    const res = makeResponse()

    await createReportHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create report' })
  })

  it('never logs the details field', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: APARTMENT_ID, owner_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'report-1', status: 'open' }] })

    const secretDetails = 'personal data goes here'
    const req = makeRequest({ body: { category: 'safety', details: secretDetails, clientOpId: CLIENT_OP_ID } })
    const res = makeResponse()

    await createReportHandler(req, res)

    const loggedOutput = logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(loggedOutput).not.toContain(secretDetails)
    logSpy.mockRestore()
  })
})
