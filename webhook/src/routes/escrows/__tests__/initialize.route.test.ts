import request from 'supertest'
import express from 'express'

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn().mockResolvedValue({}),
}))

jest.mock('../../../repositories/webhook-event.repository', () => ({
  logAndCheckWebhookEvent: jest.fn().mockResolvedValue({ isDuplicate: false, eventId: 'event-1' }),
  markWebhookEventProcessed: jest.fn().mockResolvedValue(true),
}))

jest.mock('../../../repositories/escrow.repository', () => ({
  createEscrow: jest.fn().mockResolvedValue({ id: 'escrow-1' }),
}))

jest.mock('../../../middleware/trustlesswork-signature.middleware', () => ({
  __esModule: true,
  default: jest.fn((_req: any, _res: any, next: any) => next()),
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

  it('uses TrustlessWork signature verification when x402 is disabled and a signature header is present', async () => {
    process.env.X402_ENABLED = 'false'
    const router = require('../initialize.route').default
    const signatureMiddleware =
      require('../../../middleware/trustlesswork-signature.middleware').default

    const app = express()
    app.use(express.json())
    app.use(router)

    await request(app)
      .post('/api/escrows/initialize')
      .set('x-trustlesswork-signature', 'test-signature')
      .send({ contract_id: 'test-123' })

    expect(signatureMiddleware).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when x402 is disabled and no TrustlessWork signature is present', async () => {
    process.env.X402_ENABLED = 'false'
    const router = require('../initialize.route').default

    const app = express()
    app.use(express.json())
    app.use(router)

    // No payment or TrustlessWork signature must not reach the handler.
    const res = await request(app)
      .post('/api/escrows/initialize')
      .send({})

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('Feature Unavailable')
    expect(res.body.feature).toBe('x402')
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
