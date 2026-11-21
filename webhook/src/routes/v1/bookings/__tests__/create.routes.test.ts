import express from 'express'
import request from 'supertest'

const mockQuery = jest.fn()
const mockWithTransaction = jest.fn()

jest.mock('../../../../services/db', () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (cb: (client: any) => Promise<any>) => mockWithTransaction(cb),
}))

import bookingsRouter from '../index'
import { errorHandler } from '../../../../middleware/error-handler'
import { setX402Addon } from '../../../../middleware/x402-payment.middleware'

const APT_ID = '11111111-1111-4111-8111-111111111111'
const HOLD_ID = '22222222-2222-4222-8222-222222222222'

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

describe('v1 create booking route (POST /api/v1/bookings) - Issue #778', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.X402_ENABLED = 'true'
    process.env.SAFETRUST_PLATFORM_WALLET = 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM'
    setX402Addon({
      validateX402Payment: () =>
        JSON.stringify({
          is_valid: true,
          payer_address: 'GAGENTWALLET000000000000000000000000000000000000000000000',
          amount_usdc: 0.10,
          network: 'stellar:testnet',
        }),
      buildPaymentRequirement: (amount: number) =>
        JSON.stringify({ maxAmountRequired: amount, network: 'stellar:testnet' }),
    })
  })

  it('rejects unauthenticated requests with 401 when under /api boundary', async () => {
    // Note: when mounted in the full app, the /api boundary catches missing context.
    const res = await request(app(null)).post('/api/v1/bookings').send({ hold_id: HOLD_ID })
    expect(res.status).toBe(401)
  })

  it('answers 402 with 0.10 USDC requirement when no x-payment header is sent', async () => {
    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(402)
    expect(res.body.accepts[0].maxAmountRequired).toBe(0.10)
  })

  it('returns 409 when hold is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }) // hold query returns nothing

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Hold not found')
  })

  it('returns 409 when hold is owned by a different user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'other-user',
          status: 'active',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('not owned by the caller')
  })

  it('returns 409 when hold has expired', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          status: 'active',
          expires_at: new Date(Date.now() - 10000),
          is_expired: true,
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Hold has expired')
  })

  it('ensures idempotency: returns existing reservation and XDR without deploying a second escrow', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          status: 'converted',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
          reservation_id: 'res-existing-123',
          contract_id: 'CAATN5DEXISTING000000000000000000000000000000000000000001',
          unsigned_xdr: 'AAAA_EXISTING_UNSIGNED_XDR_123',
          quote_deposit: '50.00',
          asset_code: 'USDC',
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      reservation_id: 'res-existing-123',
      contract_id: 'CAATN5DEXISTING000000000000000000000000000000000000000001',
      deposit: '50.00',
      asset: 'USDC',
      unsigned_xdr: 'AAAA_EXISTING_UNSIGNED_XDR_123',
    })
    // Crucial check: withTransaction was not invoked to re-convert or re-deploy
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('converts active hold, deploys escrow, generates unsigned XDR and returns 201', async () => {
    // 1. Hold lookup query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          check_in: '2026-12-15',
          check_out: '2026-12-20',
          guests: 2,
          status: 'active',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
        },
      ],
    })

    // 2. getQuoteForProperty query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: APT_ID,
          name: 'Modern Apartment',
          price: '100.00',
          warranty_deposit: '50.00',
          owner_id: 'host-1',
          is_available: true,
          bedrooms: 1,
        },
      ],
    })

    // 3. withTransaction executing atomic hold conversion and reservation creation in escrow_created status
    mockWithTransaction.mockImplementationOnce(async (cb) => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: HOLD_ID, status: 'active' }] }) // FOR UPDATE
          .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE hold status = 'converted'
          .mockResolvedValueOnce({ rows: [{ id: 'res-new-778' }] }), // INSERT reservation status = 'escrow_created'
      }
      return cb(mockClient)
    })

    // 4. resolveUserStellarWallet query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GAGENTWALLET000000000000000000000000000000000000000000000',
          is_primary: true,
        },
      ],
    })

    // 5. resolveOwnerStellarWallet query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GHOSTWALLET000000000000000000000000000000000000000000000',
          is_primary: true,
        },
      ],
    })

    // 6. deployBookingEscrow insert into trustless_work_escrows
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'escrow-db-1',
          contract_id: 'CAATN5DNEWCONTRACT00000000000000000000000000000000000001',
        },
      ],
    })

    // 7. link escrow to reservation
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })

    // 8. generateFundEscrowXdr insert into escrow_transactions
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      reservation_id: 'res-new-778',
      contract_id: expect.stringMatching(/^C[A-Z0-9]{55}$/),
      deposit: '50.00',
      asset: 'USDC',
      unsigned_xdr: expect.any(String),
    })
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  it('rejects request with 400 when neither hold_id nor property details are sent', async () => {
    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Either hold_id or property_id')
  })
})
