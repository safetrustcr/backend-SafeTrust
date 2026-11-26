import express from 'express'
import request from 'supertest'

const mockQuery = jest.fn()
jest.mock('../../../../services/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  withTransaction: jest.fn(),
}))
const mockCreate = jest.fn()
jest.mock('../../../../repositories/hold.repository', () => ({
  ...jest.requireActual('../../../../repositories/hold.repository'),
  createHold: (...a: unknown[]) => mockCreate(...a),
}))

import bookingsRouter from '../index'
import { errorHandler } from '../../../../middleware/error-handler'
import { setX402Addon } from '../../../../middleware/x402-payment.middleware'

const APT = '11111111-1111-4111-8111-111111111111'
const body = { property_id: APT, check_in: '2026-12-15', check_out: '2026-12-20', guests: 4 }

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

describe('v1 booking holds routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.X402_ENABLED = 'true'
    process.env.SAFETRUST_PLATFORM_WALLET = 'GWALLET'
    setX402Addon({
      validateX402Payment: () => JSON.stringify({ is_valid: true, payer_address: 'GPAYER', amount_usdc: 0.01, network: 'stellar:testnet' }),
      buildPaymentRequirement: (amount: number) => JSON.stringify({ maxAmountRequired: amount }),
    })
  })

  it('answers 402 with a 0.01 USDC requirement when no payment is sent', async () => {
    const res = await request(app('u1')).post('/api/v1/bookings/hold').send(body)
    expect(res.status).toBe(402)
    expect(res.body.accepts[0].maxAmountRequired).toBe(0.01)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates and activates a hold once paid', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: new Date('2026-12-01T14:32:00Z'), quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })
    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      hold_id: 'h1',
      expires_at: '2026-12-01T14:32:00.000Z',
      quote: { total: '150.00', deposit: '45.00', asset: 'USDC' },
    })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', tenantId: 'safetrust', payerAddress: 'GPAYER' }))
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'active'")
  })

  it('rejects bad input with 400 after payment verification', async () => {
    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send({ ...body, check_out: '2026-12-10' })
    expect(res.status).toBe(400)
  })

  it('returns 403 when releasing someone else\'s hold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'other', status: 'active' }] })
    const res = await request(app('u1')).delete('/api/v1/bookings/hold/22222222-2222-4222-8222-222222222222')
    expect(res.status).toBe(403)
  })

  it('releases the caller\'s own hold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', status: 'active' }] }).mockResolvedValueOnce({ rowCount: 1, rows: [] })
    const res = await request(app('u1')).delete('/api/v1/bookings/hold/22222222-2222-4222-8222-222222222222')
    expect(res.status).toBe(204)
  })
})
