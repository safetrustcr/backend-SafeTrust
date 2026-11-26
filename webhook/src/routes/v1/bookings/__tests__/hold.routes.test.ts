import express from 'express'
import request from 'supertest'
import { FacilitatorClient } from '@x402/core/server'

const mockQuery = jest.fn()
jest.mock('../../../../services/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  withTransaction: jest.fn(),
}))
const mockCreate = jest.fn()
const mockReleaseHold = jest.fn()
jest.mock('../../../../repositories/hold.repository', () => ({
  ...jest.requireActual('../../../../repositories/hold.repository'),
  createHold: (...a: unknown[]) => mockCreate(...a),
  releaseHold: (...a: unknown[]) => mockReleaseHold(...a),
}))

import bookingsRouter, { setHoldPaymentMiddleware } from '../index'
import { errorHandler } from '../../../../middleware/error-handler'
import { buildX402ResourceServer, setX402ResourceServer } from '../../../../config/x402'

const APT = '11111111-1111-4111-8111-111111111111'
const body = { property_id: APT, check_in: '2026-12-15', check_out: '2026-12-20', guests: 4 }
const VALID_WALLET = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'

function createMockFacilitatorClient(): FacilitatorClient {
  return {
    getSupported: jest.fn().mockResolvedValue({
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: 'stellar:testnet',
          extra: { areFeesSponsored: true },
        },
      ],
      signers: {
        'stellar:*': ['GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K'],
      },
      extensions: [],
    }),
    verify: jest.fn().mockResolvedValue({
      isValid: true,
      payer: 'GPAYER',
    }),
    settle: jest.fn().mockResolvedValue({
      success: true,
      transaction: '0xmockedstellarsettletx123',
      network: 'stellar:testnet',
    }),
  }
}

function app(uid: string | null) {
  const a = express()
  a.use(express.json())
  a.use((req, _res, next) => {
    if (uid) (req as any).context = { uid, tenantId: 'safetrust', roles: [] }
    next()
  })
  a.use('/api/v1/bookings', bookingsRouter)
  a.use(errorHandler)
  return a
}

async function createPaymentSignature(testApp: express.Express): Promise<string> {
  const unpaid = await request(testApp).post('/api/v1/bookings/hold').send(body)
  const paymentRequired = JSON.parse(
    Buffer.from(unpaid.headers['payment-required'], 'base64').toString('utf8')
  )
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: paymentRequired.accepts[0],
      payload: { transaction: 'AAAA...signed-soroban-auth' },
    })
  ).toString('base64')
}

describe('v1 booking holds routes', () => {
  const originalEnv = process.env

  beforeEach(async () => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.X402_ENABLED = 'true'
    process.env.STELLAR_NETWORK = 'testnet'
    process.env.SAFETRUST_PLATFORM_WALLET = VALID_WALLET
    process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'

    setHoldPaymentMiddleware(null)
    setX402ResourceServer(null)
    const server = buildX402ResourceServer(createMockFacilitatorClient(), 'stellar:testnet')
    await server.initialize()
    setX402ResourceServer(server)
  })

  afterAll(() => {
    process.env = originalEnv
    setHoldPaymentMiddleware(null)
    setX402ResourceServer(null)
  })

  it('answers 402 with a 0.01 USDC requirement when no payment is sent', async () => {
    const res = await request(app('u1')).post('/api/v1/bookings/hold').send(body)
    expect(res.status).toBe(402)
    expect(res.body.accepts[0].maxAmountRequired).toBe(0.01)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates and activates a hold once paid', async () => {
    mockCreate.mockResolvedValue({
      id: 'h1',
      expires_at: new Date('2026-12-01T14:32:00Z'),
      quote_deposit: '45',
      asset_code: 'USDC',
      price_total: '150.00',
    })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })

    const testApp = app('u1')
    const sig = await createPaymentSignature(testApp)
    const res = await request(testApp)
      .post('/api/v1/bookings/hold')
      .set('payment-signature', sig)
      .send(body)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      hold_id: 'h1',
      expires_at: '2026-12-01T14:32:00.000Z',
      quote: { total: '150.00', deposit: '45.00', asset: 'USDC' },
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tenantId: 'safetrust', payerAddress: 'GPAYER' })
    )
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'active'")
  })

  it('rejects bad input with 400 after payment verification', async () => {
    const testApp = app('u1')
    const sig = await createPaymentSignature(testApp)
    const res = await request(testApp)
      .post('/api/v1/bookings/hold')
      .set('payment-signature', sig)
      .send({ ...body, check_out: '2026-12-10' })
    expect(res.status).toBe(400)
  })

  it('releases an activated hold if x402 settlement fails after handler succeeds', async () => {
    const failingSettleClient = createMockFacilitatorClient()
    ;(failingSettleClient.settle as jest.Mock).mockResolvedValueOnce({
      success: false,
      errorReason: 'Insufficient balance at settlement',
    })
    const server = buildX402ResourceServer(failingSettleClient, 'stellar:testnet')
    await server.initialize()
    setX402ResourceServer(server)

    mockCreate.mockResolvedValue({
      id: 'h-settle-fail',
      expires_at: new Date('2026-12-01T14:32:00Z'),
      quote_deposit: '45',
      asset_code: 'USDC',
      price_total: '150.00',
    })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })
    mockReleaseHold.mockResolvedValue(undefined)

    const testApp = app('u1')
    const sig = await createPaymentSignature(testApp)
    const res = await request(testApp)
      .post('/api/v1/bookings/hold')
      .set('payment-signature', sig)
      .send(body)

    expect(res.status).not.toBe(201)
    expect(mockReleaseHold).toHaveBeenCalledWith('h-settle-fail', 'u1', 'safetrust')
  })

  it("returns 403 when releasing someone else's hold", async () => {
    mockReleaseHold.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'forbidden' })
    )
    const res = await request(app('u1')).delete('/api/v1/bookings/hold/22222222-2222-4222-8222-222222222222')
    expect(res.status).toBe(403)
  })

  it("releases the caller's own hold", async () => {
    mockReleaseHold.mockResolvedValueOnce(undefined)
    const res = await request(app('u1')).delete('/api/v1/bookings/hold/22222222-2222-4222-8222-222222222222')
    expect(res.status).toBe(204)
  })
})
