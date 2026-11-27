import request from 'supertest'
import express from 'express'
import router, { setPaymentMiddleware } from '../initialize.route'
import { setX402ResourceServer, buildX402ResourceServer } from '../../../config/x402'
import { FacilitatorClient } from '@x402/core/server'
import { errorHandler } from '../../../middleware/error-handler'

jest.mock('../../../services/escrow.service', () => ({
  EscrowValidationError: class EscrowValidationError extends Error {
    constructor(message: string, readonly statusCode = 400) {
      super(message)
    }
  },
  ReservationNotFoundError: class ReservationNotFoundError extends Error {},
  TenantMismatchError: class TenantMismatchError extends Error {},
  ZkVerifierUnavailableError: class ZkVerifierUnavailableError extends Error {},
  initializeEscrow: jest.fn().mockResolvedValue({
    isDuplicate: false,
    eventId: 'event-1',
    escrow: { id: 'escrow-1' },
  }),
}))

const validPlatformWallet = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'

const validEscrowBody = {
  contract_id: 'test-contract-001',
  marker: 'test-marker',
  approver: 'test-approver',
  releaser: 'test-releaser',
  amount: 100,
  escrow_type: 'single_release',
}

function createMockFacilitatorClient(overrides?: {
  verify?: (payload: any, reqs: any) => Promise<any>
  settle?: (payload: any, reqs: any) => Promise<any>
}): FacilitatorClient {
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
    verify: overrides?.verify ?? jest.fn().mockResolvedValue({
      isValid: true,
      payer: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    }),
    settle: overrides?.settle ?? jest.fn().mockResolvedValue({
      success: true,
      transaction: '0xmockedstellarsettletx123',
      network: 'stellar:testnet',
    }),
  }
}

describe('initialize.route with official x402 payment gate', () => {
  const originalEnv = process.env
  let app: express.Express

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    setPaymentMiddleware(null)
    setX402ResourceServer(null)

    app = express()
    app.use(express.json())
    app.use(router)
    app.use(errorHandler)
  })

  afterAll(() => {
    process.env = originalEnv
    setPaymentMiddleware(null)
    setX402ResourceServer(null)
  })

  describe('Disabled State (X402_ENABLED=false)', () => {
    beforeEach(() => {
      process.env.X402_ENABLED = 'false'
    })

    it('returns 503 when x402 is disabled', async () => {
      const res = await request(app)
        .post('/api/escrows/initialize')
        .send({})

      expect(res.status).toBe(503)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Service unavailable')
      expect(res.body.code).toBe('feature_unavailable')
    })

    it('fails closed when an X-Payment header is sent while x402 is disabled', async () => {
      const res = await request(app)
        .post('/api/escrows/initialize')
        .set('x-payment', 'x402 valid-payload')
        .send({})

      expect(res.status).toBe(503)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Service unavailable')
      expect(res.body.code).toBe('feature_unavailable')
    })

    it('fails closed when payment-signature is sent while x402 is disabled', async () => {
      const res = await request(app)
        .post('/api/escrows/initialize')
        .set('payment-signature', 'base64-payload')
        .send({})

      expect(res.status).toBe(503)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Service unavailable')
      expect(res.body.code).toBe('feature_unavailable')
    })
  })

  describe('Enabled State (X402_ENABLED=true)', () => {
    let mockClient: FacilitatorClient

    beforeEach(async () => {
      process.env.X402_ENABLED = 'true'
      process.env.STELLAR_NETWORK = 'testnet'
      process.env.SAFETRUST_PLATFORM_WALLET = validPlatformWallet
      process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'

      mockClient = createMockFacilitatorClient()
      const server = buildX402ResourceServer(mockClient, 'stellar:testnet')
      await server.initialize()
      setX402ResourceServer(server)
    })

    it('enforces 402 payment when payment header is missing', async () => {
      const res = await request(app)
        .post('/api/escrows/initialize')
        .send({ contract_id: 'test-123' })

      expect(res.status).toBe(402)
      expect(res.headers['payment-required']).toBeDefined()

      const rawRequired = Buffer.from(res.headers['payment-required'], 'base64').toString('utf8')
      const paymentRequired = JSON.parse(rawRequired)

      expect(paymentRequired.x402Version).toBe(2)
      expect(paymentRequired.accepts).toBeDefined()
      expect(paymentRequired.accepts.length).toBeGreaterThan(0)
      expect(paymentRequired.accepts[0].scheme).toBe('exact')
      expect(paymentRequired.accepts[0].network).toBe('stellar:testnet')
      expect(paymentRequired.accepts[0].payTo).toBe(validPlatformWallet)
      expect(paymentRequired.accepts[0].amount).toBe('1000000') // $0.10 USDC (7 decimals)
      expect(paymentRequired.accepts[0].asset).toBe(
        'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' // Testnet USDC contract ID
      )
    })

    it('verifies and settles valid payment, then invokes handler and attaches PAYMENT-RESPONSE', async () => {
      const unpaidRes = await request(app).post('/api/escrows/initialize').send({})
      const paymentRequired = JSON.parse(
        Buffer.from(unpaidRes.headers['payment-required'], 'base64').toString('utf8')
      )
      const accepted = paymentRequired.accepts[0]

      const validPaymentPayload = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          accepted,
          payload: { transaction: 'AAAA...signed-soroban-auth' },
        })
      ).toString('base64')

      const res = await request(app)
        .post('/api/escrows/initialize')
        .set('payment-signature', validPaymentPayload)
        .send(validEscrowBody)

      expect(mockClient.verify).toHaveBeenCalled()
      expect(mockClient.settle).toHaveBeenCalled()
      expect(res.status).toBe(200)
      expect(res.headers['payment-response']).toBeDefined()

      const rawReceipt = Buffer.from(res.headers['payment-response'], 'base64').toString('utf8')
      const receipt = JSON.parse(rawReceipt)
      expect(receipt.success).toBe(true)
      expect(receipt.transaction).toBe('0xmockedstellarsettletx123')
    })

    it('does not trust legacy x-payment on the paid path and requires PAYMENT-SIGNATURE', async () => {
      const res = await request(app)
        .post('/api/escrows/initialize')
        .set('x-payment', 'legacy-payload')
        .send(validEscrowBody)

      expect(res.status).toBe(402)
      expect(res.headers['payment-required']).toBeDefined()
      expect(mockClient.verify).not.toHaveBeenCalled()
    })

    it('rejects request with 402 when facilitator verification fails', async () => {
      const failingVerifyClient = createMockFacilitatorClient({
        verify: jest.fn().mockResolvedValue({
          isValid: false,
          invalidReason: 'Invalid authorization signature',
        }),
      })
      const server = buildX402ResourceServer(failingVerifyClient, 'stellar:testnet')
      await server.initialize()
      setX402ResourceServer(server)

      const unpaidRes = await request(app).post('/api/escrows/initialize').send({})
      const paymentRequired = JSON.parse(
        Buffer.from(unpaidRes.headers['payment-required'], 'base64').toString('utf8')
      )
      const accepted = paymentRequired.accepts[0]

      const paymentPayload = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          accepted,
          payload: { transaction: 'invalid-tx' },
        })
      ).toString('base64')

      const res = await request(app)
        .post('/api/escrows/initialize')
        .set('payment-signature', paymentPayload)
        .send(validEscrowBody)

      expect(failingVerifyClient.verify).toHaveBeenCalled()
      expect(failingVerifyClient.settle).not.toHaveBeenCalled()
      expect(res.status).toBe(402)
    })

    it('handles settlement failure before handler response is returned', async () => {
      const failingSettleClient = createMockFacilitatorClient({
        settle: jest.fn().mockResolvedValue({
          success: false,
          errorReason: 'Contract call failed: missing trustline',
        }),
      })
      const server = buildX402ResourceServer(failingSettleClient, 'stellar:testnet')
      await server.initialize()
      setX402ResourceServer(server)

      const unpaidRes = await request(app).post('/api/escrows/initialize').send({})
      const paymentRequired = JSON.parse(
        Buffer.from(unpaidRes.headers['payment-required'], 'base64').toString('utf8')
      )
      const accepted = paymentRequired.accepts[0]

      const paymentPayload = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          accepted,
          payload: { transaction: 'tx-missing-trustline' },
        })
      ).toString('base64')

      const res = await request(app)
        .post('/api/escrows/initialize')
        .set('payment-signature', paymentPayload)
        .send(validEscrowBody)

      expect(failingSettleClient.verify).toHaveBeenCalled()
      expect(failingSettleClient.settle).toHaveBeenCalled()
      // Settlement failed, so status is error and handler response is not returned as 200
      expect(res.status).not.toBe(200)
    })
  })
})
