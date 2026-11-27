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

const mockSettleBookingFee = jest.fn()
const mockFindSettledHoldFee = jest.fn()
jest.mock('../../../../services/x402-settlement.service', () => ({
  settleBookingFee: (...a: unknown[]) => mockSettleBookingFee(...a),
  findSettledHoldFee: (...a: unknown[]) => mockFindSettledHoldFee(...a),
}))

import bookingsRouter from '../index'
import { errorHandler } from '../../../../middleware/error-handler'
import { setX402Engine } from '../../../../middleware/x402-payment.middleware'

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
    setX402Engine({
      validateX402Payment: () => JSON.stringify({ is_valid: true, payer_address: 'GPAYER', amount_usdc: 0.01, network: 'stellar:testnet' }),
      buildPaymentRequirement: (amount: number) => JSON.stringify({ maxAmountRequired: amount }),
    })
    mockFindSettledHoldFee.mockResolvedValue(undefined)
  })

  it('answers 402 with a 0.01 USDC requirement when no payment is sent', async () => {
    const res = await request(app('u1')).post('/api/v1/bookings/hold').send(body)
    expect(res.status).toBe(402)
    expect(res.body.accepts[0].maxAmountRequired).toBe(0.01)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates and activates a hold once paid', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: new Date('2026-12-01T14:32:00Z'), quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockResolvedValue({ idempotencyKey: 'k', transactionHash: 'tx', reused: false })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })
    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      hold_id: 'h1',
      expires_at: '2026-12-01T14:32:00.000Z',
      quote: { total: '150.00', deposit: '45.00', asset: 'USDC' },
    })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', tenantId: 'safetrust', payerAddress: 'GPAYER' }))
    // The 0.01 USDC hold fee is settled before the hold is activated.
    expect(mockSettleBookingFee).toHaveBeenCalledWith(
      expect.objectContaining({ paymentHeader: 'abc', amountUsdc: 0.01, purpose: 'hold_fee', holdId: 'h1' })
    )
    expect(mockSettleBookingFee.mock.invocationCallOrder[0]).toBeLessThan(
      mockQuery.mock.invocationCallOrder[0]
    )
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'active'")
  })

  it('releases the pending hold when hold fee settlement fails', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: new Date('2026-12-01T14:32:00Z'), quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockRejectedValueOnce(new Error('settlement down'))
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(500)
    const releaseCall = mockQuery.mock.calls.find((call) => String(call[0]).includes("status = 'released'"))
    expect(releaseCall).toBeDefined()
    expect(releaseCall?.[1]).toEqual(['h1'])
    // The unactivated hold must not be activated after a failed settlement.
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'active'"))).toBe(false)
  })

  it('keeps a paid hold recoverable instead of releasing it when activation does not complete', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: new Date('2026-12-01T14:32:00Z'), quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockResolvedValue({ idempotencyKey: 'k', transactionHash: 'tx', reused: false })
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] }) // the hold never reaches active

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('hold_activation_pending')
    // The settled hold is the only record of a paid booking: never released.
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'released'"))).toBe(false)
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('status = \'active\'') && String(call[0]).includes('pending_payment'))).toBe(true)
  })

  it('resumes the paid hold on retry instead of creating a second one', async () => {
    const expiresAt = new Date('2026-12-01T14:32:00Z')
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'h1',
          tenant_id: 'safetrust',
          apartment_id: APT,
          user_id: 'u1',
          check_in: new Date('2026-12-15T00:00:00Z'),
          check_out: new Date('2026-12-20T00:00:00Z'),
          guests: 4,
          status: 'pending_payment',
          quote_total: '150.00',
          quote_deposit: '45',
          asset_code: 'USDC',
          payer_address: 'GPAYER',
          expires_at: expiresAt,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] }) // activation

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(201)
    expect(res.body.hold_id).toBe('h1')
    expect(res.body.quote).toEqual({ total: '150.00', deposit: '45.00', asset: 'USDC' })
    // The proof already paid for this hold: no second hold, no second charge.
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('rejects a retry of an expired paid hold with 409 hold_expired', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'h1',
          tenant_id: 'safetrust',
          apartment_id: APT,
          user_id: 'u1',
          check_in: new Date('2026-12-15T00:00:00Z'),
          check_out: new Date('2026-12-20T00:00:00Z'),
          guests: 4,
          status: 'active',
          quote_total: '150.00',
          quote_deposit: '45',
          asset_code: 'USDC',
          payer_address: 'GPAYER',
          expires_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('hold_expired')
    // The settled fee is not charged again and no second hold is created.
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('rejects a retry of a hold already marked expired with 409 hold_expired', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'h1',
          tenant_id: 'safetrust',
          apartment_id: APT,
          user_id: 'u1',
          check_in: new Date('2026-12-15T00:00:00Z'),
          check_out: new Date('2026-12-20T00:00:00Z'),
          guests: 4,
          status: 'expired',
          quote_total: '150.00',
          quote_deposit: '45',
          asset_code: 'USDC',
          payer_address: 'GPAYER',
          expires_at: new Date('2026-12-01T14:32:00Z'),
        },
      ],
    })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('hold_expired')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
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
