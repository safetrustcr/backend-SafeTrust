import express from 'express'
import request from 'supertest'
import { setX402Addon } from '../../../../middleware/x402-payment.middleware'
import type { PropertyAvailabilityRow } from '../../../../repositories/property.repository'
import {
  findPropertyAvailability,
  searchProperties,
} from '../../../../repositories/property.repository'
import propertiesRouter from '../index'
import { authMiddleware } from '../../../../middleware/auth.middleware'

jest.mock('../../../../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn(),
}))

jest.mock('../../../../repositories/property.repository', () => ({
  findPropertyAvailability: jest.fn(),
  searchProperties: jest.fn(),
}))

const mockAuthMiddleware = authMiddleware as jest.Mock

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'
const query = 'check_in=2099-12-15&check_out=2099-12-20&guests=4'
const property: PropertyAvailabilityRow = {
  id: PROPERTY_ID,
  name: 'Bay View',
  description: 'Quiet apartment',
  address: { city: 'San Juan' },
  nightly_price: '30.00',
  warranty_deposit: '45.00',
  bedrooms: 2,
  max_guests: 4,
  available: true,
}

function createApp() {
  const app = express()
  app.use('/api/v1/properties', propertiesRouter)
  return app
}

describe('agent property routes', () => {
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
    mockAuthMiddleware.mockImplementation((req, res, next) => {
      if (req.headers.authorization === 'Bearer valid-token') {
        req.context = { uid: 'guest-1', tenantId: 'safetrust', roles: ['guest'] }
        next()
        return
      }
      res.status(401).json({ error: 'Unauthorized' })
    })
  })

  it('returns a payment challenge to anonymous callers', async () => {
    const response = await request(createApp()).get(`/api/v1/properties/search?${query}`)

    expect(response.status).toBe(402)
    expect(response.body.accepts).toEqual([{ amount: '0.001 USDC' }])
    expect(searchProperties).not.toHaveBeenCalled()
  })

  it('returns search quotes to a valid Firebase session without payment', async () => {
    ;(searchProperties as jest.Mock).mockResolvedValueOnce({
      rows: [property],
      hasMore: false,
    })

    const response = await request(createApp())
      .get(`/api/v1/properties/search?${query}&min_bedrooms=2&max_price=100.00`)
      .set('Authorization', 'Bearer valid-token')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      properties: [{
        id: PROPERTY_ID,
        name: 'Bay View',
        description: 'Quiet apartment',
        address: { city: 'San Juan' },
        bedrooms: 2,
        max_guests: 4,
        available: true,
        nights: 5,
        nightly_price: '30.00',
        total: '150.00',
        deposit: '45.00',
        asset: 'USDC',
      }],
      page: 1,
      limit: 20,
      has_more: false,
    })
    expect(buildPaymentRequirement).not.toHaveBeenCalled()
    expect(validateX402Payment).not.toHaveBeenCalled()
  })

  it('returns 401 for an invalid token instead of attempting payment', async () => {
    const response = await request(createApp())
      .get(`/api/v1/properties/search?${query}`)
      .set('Authorization', 'Bearer expired-token')
      .set('x-payment', 'payment')

    expect(response.status).toBe(401)
    expect(validateX402Payment).not.toHaveBeenCalled()
    expect(searchProperties).not.toHaveBeenCalled()
  })

  it('validates input before requesting payment', async () => {
    const response = await request(createApp())
      .get('/api/v1/properties/search?check_in=2099-12-20&check_out=2099-12-15&guests=4')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('validation_failed')
    expect(buildPaymentRequirement).not.toHaveBeenCalled()
  })

  it('rejects pages that exceed the database function limit before payment', async () => {
    const response = await request(createApp())
      .get(`/api/v1/properties/search?${query}&page=100000000&limit=50`)

    expect(response.status).toBe(400)
    expect(response.body.fields.page).toBeDefined()
    expect(buildPaymentRequirement).not.toHaveBeenCalled()
  })

  it('returns unavailable when reservation or hold overlap is found', async () => {
    ;(findPropertyAvailability as jest.Mock).mockResolvedValueOnce({
      ...property,
      available: false,
    })

    const response = await request(createApp())
      .get(`/api/v1/properties/${PROPERTY_ID}/availability?${query}`)
      .set('Authorization', 'Bearer valid-token')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      property_id: PROPERTY_ID,
      available: false,
      nights: 5,
      nightly_price: '30.00',
      total: '150.00',
      deposit: '45.00',
      asset: 'USDC',
    })
  })

  it('validates the property id before requesting payment', async () => {
    const response = await request(createApp())
      .get(`/api/v1/properties/not-a-uuid/availability?${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('validation_failed')
    expect(buildPaymentRequirement).not.toHaveBeenCalled()
  })
})
