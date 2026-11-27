import express from 'express'
import request from 'supertest'

const mockQuery = jest.fn()
const mockWithTransaction = jest.fn()
const mockSettleBookingFee = jest.fn()
const mockBindSettlementToReservation = jest.fn()
const mockFindSettledBookingFee = jest.fn()

jest.mock('../../../../services/x402-settlement.service', () => ({
  settleBookingFee: (...args: unknown[]) => mockSettleBookingFee(...args),
  settlementIdempotencyKey: () => 'payment-key',
  bindSettlementToReservation: (...args: unknown[]) =>
    mockBindSettlementToReservation(...args),
  findSettledBookingFee: (...args: unknown[]) => mockFindSettledBookingFee(...args),
}))

jest.mock('../../../../services/db', () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (cb: (client: any) => Promise<any>) => mockWithTransaction(cb),
}))

import bookingsRouter from '../index'
import { errorHandler } from '../../../../middleware/error-handler'
import { PaymentRequiredError } from '../../../../utils/errors'
import { setX402Engine } from '../../../../middleware/x402-payment.middleware'

const APT_ID = '11111111-1111-4111-8111-111111111111'
const HOLD_ID = '22222222-2222-4222-8222-222222222222'

function app(uid: string | null) {
  const a = express()
  a.use(express.json())
  a.use((req, res, next) => {
    if (uid) {
      ;(req as any).context = { uid, tenantId: 'safetrust', roles: [] }
      next()
    } else {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing or malformed Authorization header' })
    }
  })
  a.use('/api/v1/bookings', bookingsRouter)
  a.use(errorHandler)
  return a
}

describe('v1 create booking route (POST /api/v1/bookings) - Issue #778', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettleBookingFee.mockResolvedValue({
      idempotencyKey: 'payment-key',
      transactionHash: 'settlement-tx-hash',
      reused: false,
      reservationId: null,
    })
    mockBindSettlementToReservation.mockResolvedValue(undefined)
    mockFindSettledBookingFee.mockResolvedValue(undefined)
    process.env.X402_ENABLED = 'true'
    process.env.SAFETRUST_PLATFORM_WALLET = 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM'
    setX402Engine({
      validateX402Payment: () =>
        JSON.stringify({
          is_valid: true,
          payer_address: 'GB7TAYRUZTW6PC7L2L5Q2K4M6N8P2Q4R6S8T2U4V6W8X2Y4Z6A2B4C6D',
          amount_usdc: 0.10,
          network: 'stellar:testnet',
        }),
      buildPaymentRequirement: (amount: number) =>
        JSON.stringify({ maxAmountRequired: amount, network: 'stellar:testnet' }),
    })
  })

  it('rejects unauthenticated requests with 401 when under /api boundary', async () => {
    // Note: when mounted in the full app, the /api boundary catches missing context.
    const res = await request(app(null)).post('/api/v1/bookings').send({ hold_id: HOLD_ID })
    expect(res.status).toBe(401)
  })

  it('answers 402 with 0.10 USDC requirement when no x-payment header is sent', async () => {
    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(402)
    expect(res.body.accepts[0].maxAmountRequired).toBe(0.10)
  })

  it('returns 409 when hold is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }) // hold query returns nothing

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Hold not found')
  })

  it('returns 409 when hold is owned by a different user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'other-user',
          status: 'active',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('not owned by the caller')
  })

  it('returns 409 when hold has expired', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          status: 'active',
          expires_at: new Date(Date.now() - 10000),
          is_expired: true,
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Hold has expired')
  })

  it('ensures idempotency: returns existing reservation and XDR without deploying a second escrow', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          status: 'converted',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
          reservation_id: 'res-existing-123',
          contract_id: 'CAATN5DEXISTING000000000000000000000000000000000000000001',
          unsigned_xdr: 'AAAA_EXISTING_UNSIGNED_XDR_123',
          quote_deposit: '50.00',
          asset_code: 'USDC',
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      reservation_id: 'res-existing-123',
      contract_id: 'CAATN5DEXISTING000000000000000000000000000000000000000001',
      deposit: '50.00',
      asset: 'USDC',
      unsigned_xdr: 'AAAA_EXISTING_UNSIGNED_XDR_123',
    })
    // Crucial check: withTransaction was not invoked to re-convert or re-deploy
    expect(mockWithTransaction).not.toHaveBeenCalled()
    // A retry of an already-converted hold must not settle the fee again
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
  })

  it('returns 409 when the reservation behind a converted hold was cancelled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          status: 'converted',
          expires_at: new Date(Date.now() - 60000),
          is_expired: true,
          reservation_id: 'res-cancelled-123',
          reservation_status: 'cancelled',
          contract_id: 'CAATN5DEXISTING000000000000000000000000000000000000000001',
          unsigned_xdr: 'AAAA_EXISTING_UNSIGNED_XDR_123',
          quote_deposit: '50.00',
          asset_code: 'USDC',
        },
      ],
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('hold_expired')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('converts active hold, deploys escrow, generates unsigned XDR and returns 201', async () => {
    // 1. Hold lookup query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          check_in: '2026-12-15',
          check_out: '2026-12-20',
          guests: 2,
          status: 'active',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
        },
      ],
    })

    // 2. getQuoteForProperty query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: APT_ID,
          name: 'Modern Apartment',
          price: '100.00',
          warranty_deposit: '50.00',
          owner_id: 'host-1',
          is_available: true,
          bedrooms: 1,
        },
      ],
    })

    // 2b. Pre-settlement eligibility: apartment available, no overlapping hold, no overlapping reservation
    mockQuery.mockResolvedValueOnce({ rows: [{ is_available: true }] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    // 3. resolveUserStellarWallet query (resolved before the fee is settled)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GB7TAYRUZTW6PC7L2L5Q2K4M6N8P2Q4R6S8T2U4V6W8X2Y4Z6A2B4C6D',
          is_primary: true,
        },
      ],
    })

    // 4. resolveOwnerStellarWallet query (resolved before the fee is settled)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM',
          is_primary: true,
        },
      ],
    })

    // 5. withTransaction: lock the hold, settle the fee under the lock, then
    // convert the hold and create the reservation in escrow_created status.
    mockWithTransaction.mockImplementationOnce(async (cb) => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          const lower = String(sql).toLowerCase()
          if (lower.includes('pg_advisory_xact_lock')) return { rows: [] }
          if (lower.includes('select id, status') && lower.includes('for no key update')) {
            return {
              rows: [
                {
                  id: HOLD_ID,
                  status: 'active',
                  expires_at: new Date(Date.now() + 600000),
                  is_expired: false,
                },
              ],
            }
          }
          if (lower.includes('update safetrust.booking_holds')) return { rowCount: 1, rows: [] }
          if (lower.includes('insert into safetrust.reservations')) return { rows: [{ id: 'res-new-778' }] }
          return { rows: [], rowCount: 1 }
        }),
      }
      return cb(mockClient)
    })

    // 6. deployBookingEscrow insert into trustless_work_escrows
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'escrow-db-1',
          contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      ],
    })

    // 7. link escrow to reservation
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })

    // 8. generateFundEscrowXdr insert into escrow_transactions
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      reservation_id: 'res-new-778',
      contract_id: expect.stringMatching(/^C[A-Z0-9]{55}$/),
      deposit: '50.00',
      asset: 'USDC',
      unsigned_xdr: expect.any(String),
    })
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    expect(mockSettleBookingFee).toHaveBeenCalledTimes(1)
    expect(mockSettleBookingFee).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentHeader: 'valid-x402-proof',
        amountUsdc: 0.10,
        network: 'stellar:testnet',
      })
    )
  })

  it('fails the booking when fee settlement is not confirmed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: HOLD_ID,
          tenant_id: 'safetrust',
          apartment_id: APT_ID,
          user_id: 'agent-1',
          check_in: '2026-12-15',
          check_out: '2026-12-20',
          guests: 2,
          status: 'active',
          expires_at: new Date(Date.now() + 600000),
          is_expired: false,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: APT_ID,
          name: 'Modern Apartment',
          price: '100.00',
          warranty_deposit: '50.00',
          owner_id: 'host-1',
          is_available: true,
          bedrooms: 1,
        },
      ],
    })
    // Pre-settlement eligibility passes, so settlement is attempted.
    mockQuery.mockResolvedValueOnce({ rows: [{ is_available: true }] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    // 3. wallets resolve before the charge
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GB7TAYRUZTW6PC7L2L5Q2K4M6N8P2Q4R6S8T2U4V6W8X2Y4Z6A2B4C6D',
          is_primary: true,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM',
          is_primary: true,
        },
      ],
    })

    // 4. The hold is locked, then settlement fails before anything is written.
    mockWithTransaction.mockImplementationOnce(async (cb) => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          const lower = String(sql).toLowerCase()
          if (lower.includes('select id, status') && lower.includes('for no key update')) {
            return {
              rows: [
                {
                  id: HOLD_ID,
                  status: 'active',
                  expires_at: new Date(Date.now() + 600000),
                  is_expired: false,
                },
              ],
            }
          }
          return { rows: [], rowCount: 1 }
        }),
      }
      return cb(mockClient)
    })
    mockSettleBookingFee.mockRejectedValueOnce(
      new PaymentRequiredError('Facilitator declined settlement', {
        code: 'settlement_failed',
      })
    )

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ hold_id: HOLD_ID })

    expect(res.status).toBe(402)
    expect(res.body.code).toBe('settlement_failed')
    // The conversion transaction rolled back: no hold conversion, no reservation.
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  it('rejects an unavailable property with 409 without settling the $0.10 fee', async () => {
    // 1. getQuoteForProperty query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: APT_ID,
          name: 'Modern Apartment',
          price: '100.00',
          warranty_deposit: '50.00',
          owner_id: 'host-1',
          is_available: false,
          bedrooms: 1,
        },
      ],
    })
    // 2. Availability check rejects before any settlement.
    mockQuery.mockResolvedValueOnce({ rows: [{ is_available: false }] })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ property_id: APT_ID, check_in: '2026-12-15', check_out: '2026-12-20', guests: 2 })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('not_available')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('rejects overlapping dates with 409 without settling the $0.10 fee', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: APT_ID,
          name: 'Modern Apartment',
          price: '100.00',
          warranty_deposit: '50.00',
          owner_id: 'host-1',
          is_available: true,
          bedrooms: 1,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ is_available: true }] })
    mockQuery.mockResolvedValueOnce({ rows: [{}] }) // overlapping hold

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ property_id: APT_ID, check_in: '2026-12-15', check_out: '2026-12-20', guests: 2 })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('dates_unavailable')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('rejects request with 400 when neither hold_id nor property details are sent', async () => {
    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Either hold_id or property_id')
  })

  function mockDirectFlow(options: { settledAttempt?: Record<string, unknown> } = {}) {
    // Drop any once-values left over from an earlier test: the ordering below is
    // positional, so a stale queue would answer the wrong query.
    mockQuery.mockReset()
    // Quote
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: APT_ID,
          name: 'Modern Apartment',
          price: '100.00',
          warranty_deposit: '50.00',
          owner_id: 'host-1',
          is_available: true,
          bedrooms: 1,
        },
      ],
    })
    if (options.settledAttempt) {
      // The reservation the already-settled proof paid for, resolved before the
      // eligibility gate.
      mockQuery.mockResolvedValueOnce({ rows: [options.settledAttempt] })
      // If the gate ran first it would see this attempt's own escrow_created row
      // and reject the retry as dates_unavailable.
      mockQuery.mockResolvedValueOnce({ rows: [{ is_available: true }] })
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockQuery.mockResolvedValueOnce({ rows: [{ id: options.settledAttempt.id }] })
      return
    }
    // Eligibility: apartment available, no overlapping hold or reservation
    mockQuery.mockResolvedValueOnce({ rows: [{ is_available: true }] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    // Wallets resolve before the fee is settled
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GB7TAYRUZTW6PC7L2L5Q2K4M6N8P2Q4R6S8T2U4V6W8X2Y4Z6A2B4C6D',
          is_primary: true,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          wallet_address: 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM',
          is_primary: true,
        },
      ],
    })
  }

  it('returns the reservation a settled direct-booking proof already paid for', async () => {
    mockDirectFlow({
      settledAttempt: {
        id: 'res-bound-1',
        apartment_id: APT_ID,
        guest_id: 'agent-1',
        check_in_date: '2026-12-15',
        check_out_date: '2026-12-20',
        contract_id: 'CAATN5DBOUND000000000000000000000000000000000000000001',
        unsigned_xdr: 'AAAA_BOUND_XDR',
      },
    })
    mockFindSettledBookingFee.mockResolvedValueOnce({
      idempotencyKey: 'payment-key',
      reservationId: 'res-bound-1',
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ property_id: APT_ID, check_in: '2026-12-15', check_out: '2026-12-20', guests: 2 })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      reservation_id: 'res-bound-1',
      contract_id: 'CAATN5DBOUND000000000000000000000000000000000000000001',
      deposit: '50.00',
      asset: 'USDC',
      unsigned_xdr: 'AAAA_BOUND_XDR',
    })
    // The settled proof is resolved before the eligibility gate and is never
    // charged again: no settlement, no second reservation.
    expect(mockFindSettledBookingFee).toHaveBeenCalledTimes(1)
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('rejects a settled direct-booking proof replayed for a different booking', async () => {
    mockDirectFlow({
      settledAttempt: {
        id: 'res-bound-1',
        apartment_id: APT_ID,
        guest_id: 'agent-1',
        check_in_date: '2027-01-15',
        check_out_date: '2027-01-20',
        contract_id: 'CAATN5DBOUND000000000000000000000000000000000000000001',
        unsigned_xdr: 'AAAA_BOUND_XDR',
      },
    })
    mockFindSettledBookingFee.mockResolvedValueOnce({
      idempotencyKey: 'payment-key',
      reservationId: 'res-bound-1',
    })

    const res = await request(app('agent-1'))
      .post('/api/v1/bookings')
      .set('x-payment', 'valid-x402-proof')
      .send({ property_id: APT_ID, check_in: '2026-12-15', check_out: '2026-12-20', guests: 2 })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('settlement_reservation_mismatch')
    expect(mockSettleBookingFee).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })
})
