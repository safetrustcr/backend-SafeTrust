import express from 'express'
import request from 'supertest'
import { setX402Addon } from '../x402-payment.middleware'
import { x402UnlessAuthenticated } from '../x402-unless-authenticated'
import { authMiddleware } from '../auth.middleware'

jest.mock('../auth.middleware', () => ({
  authMiddleware: jest.fn(),
}))

const mockAuthMiddleware = authMiddleware as jest.Mock

function createApp() {
  const app = express()
  app.get('/properties', x402UnlessAuthenticated(0.001), (_req, res) => {
    res.status(200).json({ ok: true })
  })
  return app
}

describe('x402UnlessAuthenticated', () => {
  const buildPaymentRequirement = jest.fn()
  const validateX402Payment = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.X402_ENABLED = 'true'
    process.env.SAFETRUST_PLATFORM_WALLET = 'GTESTPLATFORMWALLET'
    buildPaymentRequirement.mockReturnValue(JSON.stringify({ amount: '0.001 USDC' }))
    validateX402Payment.mockReturnValue(JSON.stringify({
      is_valid: true,
      payer_address: 'GPAYER',
      amount_usdc: 0.001,
      network: 'stellar:testnet',
    }))
    setX402Addon({ buildPaymentRequirement, validateX402Payment })
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
    expect(buildPaymentRequirement).not.toHaveBeenCalled()
    expect(validateX402Payment).not.toHaveBeenCalled()
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
    expect(validateX402Payment).not.toHaveBeenCalled()
    expect(buildPaymentRequirement).not.toHaveBeenCalled()
  })
})
