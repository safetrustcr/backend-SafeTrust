import express from 'express'
import request from 'supertest'
import { publicRateLimit } from '../rate-limit'
import {
  setPropertyPaymentMiddleware,
  x402UnlessAuthenticated,
} from '../x402-unless-authenticated'
import { authMiddleware, optionalAuthMiddleware } from '../auth.middleware'

jest.mock('../auth.middleware', () => ({
  authMiddleware: jest.fn(),
  optionalAuthMiddleware: jest.fn(),
}))

const mockAuthMiddleware = authMiddleware as jest.Mock
const mockOptionalAuthMiddleware = optionalAuthMiddleware as jest.Mock

function createApp() {
  const app = express()
  app.get('/properties', publicRateLimit, x402UnlessAuthenticated(0.001), (_req, res) => {
    res.status(200).json({ ok: true })
  })
  return app
}

describe('x402UnlessAuthenticated', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOptionalAuthMiddleware.mockImplementation((req, res, next) => {
      if (typeof req.headers.authorization !== 'string') {
        next()
        return
      }
      mockAuthMiddleware(req, res, next)
    })
    setPropertyPaymentMiddleware(
      (_req, res) => res.status(402).json({
        accepts: [{ amount: '0.001 USDC' }],
      })
    )
  })

  afterEach(() => {
    setPropertyPaymentMiddleware(null)
  })

  it('routes callers without a session through the payment challenge', async () => {
    const response = await request(createApp()).get('/properties')

    expect(response.status).toBe(402)
    expect(response.body.accepts).toEqual([{ amount: '0.001 USDC' }])
    expect(mockAuthMiddleware).not.toHaveBeenCalled()
  })

  it('allows a verified session without requesting payment', async () => {
    mockAuthMiddleware.mockImplementation((req, _res, next) => {
      req.context = { uid: 'guest-1', tenantId: 'safetrust', roles: ['guest'] }
      next()
    })

    const response = await request(createApp())
      .get('/properties')
      .set('Authorization', 'Bearer valid-token')

    expect(response.status).toBe(200)
  })

  it('does not fall through to payment for an invalid session', async () => {
    mockAuthMiddleware.mockImplementation((_req, res) => {
      res.status(401).json({ error: 'Unauthorized' })
    })

    const response = await request(createApp())
      .get('/properties')
      .set('Authorization', 'Bearer expired-token')
      .set('x-payment', 'payment')

    expect(response.status).toBe(401)
  })
})
