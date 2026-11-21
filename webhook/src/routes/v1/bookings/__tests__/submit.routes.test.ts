import express from 'express'
import request from 'supertest'

const mockQuery = jest.fn()
const mockProcessHelperSubmission = jest.fn()

jest.mock('../../../../services/db', () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: jest.fn(),
}))

jest.mock('../../../../services/confirmation.service', () => ({
  ...jest.requireActual('../../../../services/confirmation.service'),
  processHelperSubmission: (params: any) => mockProcessHelperSubmission(params),
}))

import bookingsRouter from '../index'
import { errorHandler } from '../../../../middleware/error-handler'

const RES_ID = '33333333-3333-4333-8333-333333333333'
const CONTRACT_ID = 'CAATN5DTEST000000000000000000000000000000000000000000001'
const SIGNED_XDR = 'AAAA_SIGNED_XDR_SUBMISSION_TEST_999'

function app(uid: string | null) {
  const a = express()
  a.use(express.json())
  a.use((req, res, next) => {
    if (uid) {
      ;(req as any).context = { uid, tenantId: 'safetrust', roles: [] }
      next()
    } else {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing or malformed Authorization header' })
    }
  })
  a.use('/api/v1/bookings', bookingsRouter)
  a.use(errorHandler)
  return a
}

describe('v1 submit booking route (POST /api/v1/bookings/:id/submit) - Issue #778', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STELLAR_NETWORK = 'testnet'
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app(null))
      .post(`/api/v1/bookings/${RES_ID}/submit`)
      .send({ signed_xdr: SIGNED_XDR })

    expect(res.status).toBe(401)
  })

  it('rejects with 400 when signed_xdr is missing', async () => {
    const res = await request(app('agent-1'))
      .post(`/api/v1/bookings/${RES_ID}/submit`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('signed_xdr is required')
  })

  it('returns 404 when reservation is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(app('agent-1'))
      .post(`/api/v1/bookings/${RES_ID}/submit`)
      .send({ signed_xdr: SIGNED_XDR })

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Reservation not found')
  })

  it('returns 403 when authenticated agent does not own the reservation', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: RES_ID,
          guest_id: 'different-agent',
          status: 'escrow_created',
          contract_id: CONTRACT_ID,
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post(`/api/v1/bookings/${RES_ID}/submit`)
      .send({ signed_xdr: SIGNED_XDR })

    expect(res.status).toBe(403)
    expect(res.body.error).toContain('Not your reservation')
  })

  it('delegates to confirmation.service and leaves reservation status in escrow_created', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: RES_ID,
          guest_id: 'agent-1',
          status: 'escrow_created',
          contract_id: CONTRACT_ID,
        },
      ],
    })

    mockProcessHelperSubmission.mockResolvedValueOnce({
      success: true,
      stage: 'confirmed',
      txHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      escrowId: CONTRACT_ID,
      action: 'fund',
      network: 'testnet',
    })

    const res = await request(app('agent-1'))
      .post(`/api/v1/bookings/${RES_ID}/submit`)
      .send({ signed_xdr: SIGNED_XDR })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      reservation_id: RES_ID,
      contract_id: CONTRACT_ID,
      tx_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'escrow_created', // MUST REMAIN escrow_created (funded transition reserved for poller)
    })

    expect(mockProcessHelperSubmission).toHaveBeenCalledWith({
      signedXdr: SIGNED_XDR,
      escrowId: CONTRACT_ID,
      action: 'fund',
      network: 'testnet',
      isTWGenerated: true,
    })

    // Assert no DB update query was called to change reservation status to 'funded'
    const updateResQuery = mockQuery.mock.calls.find((call) =>
      typeof call[0] === 'string' &&
      call[0].toLowerCase().includes('update safetrust.reservations') &&
      call[0].toLowerCase().includes('funded')
    )
    expect(updateResQuery).toBeUndefined()
  })

  it('returns 400 with error details when confirmation service fails submission', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: RES_ID,
          guest_id: 'agent-1',
          status: 'escrow_created',
          contract_id: CONTRACT_ID,
        },
      ],
    })

    mockProcessHelperSubmission.mockResolvedValueOnce({
      success: false,
      stage: 'pending_confirmation',
      error: 'Transaction failed on-ledger',
      retryRecordId: 'retry-rec-1',
    })

    const res = await request(app('agent-1'))
      .post(`/api/v1/bookings/${RES_ID}/submit`)
      .send({ signed_xdr: SIGNED_XDR })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      success: false,
      reservation_id: RES_ID,
      contract_id: CONTRACT_ID,
      stage: 'pending_confirmation',
      error: 'Transaction failed on-ledger',
      retryRecordId: 'retry-rec-1',
      status: 'escrow_created',
    })
  })
})
