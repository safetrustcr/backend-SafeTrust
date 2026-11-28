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
import {
  PaymentRequiredError,
  ServiceUnavailableError,
} from '../../../../utils/errors'

const APT = '11111111-1111-4111-8111-111111111111'
// Fixed dates: these fixtures must not expire as the calendar moves on.
const CHECK_IN = '2030-03-15'
const CHECK_OUT = '2030-03-20'
const LIVE_EXPIRY = new Date('2030-03-15T14:32:00Z')
const body = { property_id: APT, check_in: CHECK_IN, check_out: CHECK_OUT, guests: 4 }

/** A hold row as `findHoldById` returns it for the retry path. */
function holdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    tenant_id: 'safetrust',
    apartment_id: APT,
    user_id: 'u1',
    check_in: new Date(`${CHECK_IN}T00:00:00Z`),
    check_out: new Date(`${CHECK_OUT}T00:00:00Z`),
    guests: 4,
    status: 'pending_payment',
    quote_total: '150.00',
    quote_deposit: '45',
    asset_code: 'USDC',
    payer_address: 'GPAYER',
    expires_at: LIVE_EXPIRY,
    ...overrides,
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
    // v2 clients read the same challenge from PAYMENT-REQUIRED.
    const header = res.headers['payment-required']
    expect(header).toEqual(expect.any(String))
    expect(JSON.parse(Buffer.from(header as string, 'base64').toString('utf8'))).toEqual({
      error: 'Payment Required',
      x402Version: 2,
      accepts: [{ maxAmountRequired: 0.01 }],
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates and activates a hold once paid, reading the v2 PAYMENT-SIGNATURE header', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: LIVE_EXPIRY, quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockResolvedValue({ idempotencyKey: 'k', transactionHash: 'tx', reused: false })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })
    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('payment-signature', 'abc').send(body)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      hold_id: 'h1',
      expires_at: '2030-03-15T14:32:00.000Z',
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

  it('keeps the legacy x-payment header working', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: LIVE_EXPIRY, quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockResolvedValue({ idempotencyKey: 'k', transactionHash: 'tx', reused: false })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'legacy-proof').send(body)

    expect(res.status).toBe(201)
    expect(mockSettleBookingFee).toHaveBeenCalledWith(
      expect.objectContaining({ paymentHeader: 'legacy-proof' })
    )
  })

  it('releases the pending hold when settlement confirms the payment was declined', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: LIVE_EXPIRY, quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockRejectedValueOnce(
      new PaymentRequiredError('Facilitator declined settlement', { code: 'settlement_failed' })
    )
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(402)
    const releaseCall = mockQuery.mock.calls.find((call) => String(call[0]).includes("status = 'released'"))
    expect(releaseCall).toBeDefined()
    expect(releaseCall?.[1]).toEqual(['h1'])
    // The unactivated hold must not be activated after a failed settlement.
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'active'"))).toBe(false)
  })

  it('keeps the pending hold when the settlement outcome is unknown', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: LIVE_EXPIRY, quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockRejectedValueOnce(
      new ServiceUnavailableError('x402 settlement failed')
    )
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(503)
    // The guest may have been charged: the hold is the only record of it.
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'released'"))).toBe(false)
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'active'"))).toBe(false)
  })

  it('keeps a paid hold recoverable instead of releasing it when activation does not complete', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: LIVE_EXPIRY, quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockSettleBookingFee.mockResolvedValue({ idempotencyKey: 'k', transactionHash: 'tx', reused: false })
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] }) // the hold never reaches active

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('hold_activation_pending')
    // The client is told to retry with the same proof, which resumes the hold.
    expect(res.headers['retry-after']).toBe('5')
    // The settled hold is the only record of a paid booking: never released.
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'released'"))).toBe(false)
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('status = \'active\'') && String(call[0]).includes('pending_payment'))).toBe(true)
  })

  it('resumes the paid hold on retry instead of creating a second one', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow()] })
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] }) // activation

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(201)
    expect(res.body.hold_id).toBe('h1')
    expect(res.body.quote).toEqual({ total: '150.00', deposit: '45.00', asset: 'USDC' })
    // The proof already paid for this hold: no second hold, no second charge.
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('matches the paid hold case-insensitively on property id', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow({ apartment_id: APT.toUpperCase() })] })
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] }) // activation

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(201)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('reports the hold when activation loses the race but the hold is active', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow()] })
    // activateHold matched nothing: another attempt activated it first.
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow({ status: 'active' })] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(201)
    expect(res.body.hold_id).toBe('h1')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('reports hold_expired when activation loses the race to the expiry sweep', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow()] })
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow({ status: 'expired', expires_at: new Date('2020-01-01T00:00:00Z') })] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('hold_expired')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('reports a pending activation only while the paid hold is still pending and unexpired', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow()] })
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [holdRow()] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('hold_activation_pending')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('rejects a retry of an expired paid hold with 409 hold_expired', async () => {
    mockFindSettledHoldFee.mockResolvedValueOnce({ idempotencyKey: 'k', holdId: 'h1' })
    mockQuery.mockResolvedValueOnce({
      rows: [holdRow({ status: 'active', expires_at: new Date('2020-01-01T00:00:00Z') })],
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
    mockQuery.mockResolvedValueOnce({ rows: [holdRow({ status: 'expired' })] })

    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send(body)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('hold_expired')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('does not activate the hold until the fee settlement resolves', async () => {
    mockCreate.mockResolvedValue({ id: 'h1', expires_at: LIVE_EXPIRY, quote_deposit: '45', asset_code: 'USDC', price_total: '150.00' })
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] })

    let resolveSettlement!: (value: unknown) => void
    mockSettleBookingFee.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSettlement = resolve })
    )

    // `.then` starts the supertest request so the hold is mid-flight below.
    const pending = request(app('u1'))
      .post('/api/v1/bookings/hold')
      .set('x-payment', 'abc')
      .send(body)
      .then((response) => response)

    // Give the request time to reach settlement; activation must still be blocked.
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(mockSettleBookingFee).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes("status = 'active'"))).toBe(false)

    resolveSettlement({ idempotencyKey: 'k', transactionHash: 'tx', reused: false })
    const res = await pending

    expect(res.status).toBe(201)
    // Settled first, then activated: the ordering the 201 depends on.
    expect(mockSettleBookingFee.mock.invocationCallOrder[0]).toBeLessThan(
      mockQuery.mock.invocationCallOrder[0]
    )
  })

  it('rejects bad input with 400 after payment verification', async () => {
    const res = await request(app('u1')).post('/api/v1/bookings/hold').set('x-payment', 'abc').send({ ...body, check_out: '2030-03-10' })
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
