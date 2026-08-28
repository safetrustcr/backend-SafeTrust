import request from 'supertest'
import express from 'express'

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn().mockResolvedValue({}),
  logAndCheckWebhookEvent: jest.fn().mockResolvedValue({ isDuplicate: false, eventId: 'event-1' }),
  markWebhookEventProcessed: jest.fn().mockResolvedValue(true),
}))

jest.mock('../../../middleware/trustlesswork-signature.middleware', () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
}))

describe('initialize.route with x402 payment gate', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('bypasses x402 middleware when X402_ENABLED is false (default)', async () => {
    process.env.X402_ENABLED = 'false'
    const router = require('../initialize.route').default

    const app = express()
    app.use(express.json())
    app.use(router)

    // Call without X-Payment header - should reach initializeEscrowHandler (which validates body)
    const res = await request(app)
      .post('/api/escrows/initialize')
      .send({})

    // Returns 400 from handler (missing fields) rather than 402 from middleware
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Missing required fields')
  })

  it('enforces 402 payment when X402_ENABLED is true and X-Payment is missing', async () => {
    process.env.X402_ENABLED = 'true'
    const router = require('../initialize.route').default

    const app = express()
    app.use(express.json())
    app.use(router)

    const res = await request(app)
      .post('/api/escrows/initialize')
      .send({ contract_id: 'test-123' })

    expect(res.status).toBe(402)
    expect(res.body.error).toBe('Payment Required')
    expect(res.body.x402Version).toBe(2)
    expect(res.body.accepts[0].scheme).toBe('exact')
    expect(res.body.accepts[0].network).toBe('stellar:testnet')
    expect(res.body.accepts[0].max_amount_usdc).toBe(0.10)
    expect(res.body.accepts[0].asset.code).toBe('USDC')
  })

  it('returns 402 with invalid_reason when X402_ENABLED is true and X-Payment is invalid', async () => {
    process.env.X402_ENABLED = 'true'
    const router = require('../initialize.route').default

    const app = express()
    app.use(express.json())
    app.use(router)

    const res = await request(app)
      .post('/api/escrows/initialize')
      .set('x-payment', 'invalid-header-format')
      .send({ contract_id: 'test-123' })

    expect(res.status).toBe(402)
    expect(res.body.error).toBe('Invalid x402 payment')
    expect(res.body.invalid_reason).toBeTruthy()
  })
})
