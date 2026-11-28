const mockQuery = jest.fn()

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
  query: (...args: unknown[]) => mockQuery(...args),
}))

const mockSettleX402Payment = jest.fn()

import {
  bindSettlementToReservation,
  settleBookingFee,
  settlementIdempotencyKey,
} from '../x402-settlement.service'
import { setX402Engine } from '../../middleware/x402-payment.middleware'

const HOLD_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_HOLD_ID = '33333333-3333-4333-8333-333333333333'
const RES_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_RES_ID = '55555555-5555-4555-8555-555555555555'
const PROOF = 'x402-signed-proof'
const AMOUNT = 0.1

function settledRow(holdId: string | null, reservationId: string | null = null) {
  return {
    status: 'settled',
    tx_hash: 'settled-tx-hash',
    hold_id: holdId,
    reservation_id: reservationId,
    updated_at: new Date(),
  }
}

describe('x402 settlement service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setX402Engine({
      validateX402Payment: () => JSON.stringify({ is_valid: true }),
      settleX402Payment: (...args: unknown[]) => mockSettleX402Payment(...args),
      buildPaymentRequirement: () => JSON.stringify({}),
    })
    mockSettleX402Payment.mockResolvedValue({
      settled: true,
      transaction_hash: 'new-tx-hash',
      network: 'stellar:testnet',
      error: null,
    })
  })

  it('reuses a settled proof on retry for the same booking hold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [settledRow(HOLD_ID)] })

    const receipt = await settleBookingFee({
      paymentHeader: PROOF,
      amountUsdc: AMOUNT,
      holdId: HOLD_ID,
    })

    expect(receipt).toEqual({
      idempotencyKey: settlementIdempotencyKey(PROOF, AMOUNT),
      transactionHash: 'settled-tx-hash',
      reused: true,
      reservationId: null,
    })
    expect(mockSettleX402Payment).not.toHaveBeenCalled()
  })

  it('reports the reservation a settled direct-booking proof is bound to', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [settledRow(null, RES_ID)] })

    const receipt = await settleBookingFee({ paymentHeader: PROOF, amountUsdc: AMOUNT })

    expect(receipt.reused).toBe(true)
    expect(receipt.reservationId).toBe(RES_ID)
    expect(mockSettleX402Payment).not.toHaveBeenCalled()
  })

  it('rejects a hold-bound proof replayed for a hold-less booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [settledRow(HOLD_ID)] })

    await expect(
      settleBookingFee({ paymentHeader: PROOF, amountUsdc: AMOUNT })
    ).rejects.toThrow('Payment proof was already used for a hold')

    expect(mockSettleX402Payment).not.toHaveBeenCalled()
  })

  it('binds a settled proof to only one reservation', async () => {
    const key = settlementIdempotencyKey(PROOF, AMOUNT)

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })
    await bindSettlementToReservation(key, RES_ID)
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'settled'")
    expect(mockQuery.mock.calls[0][0]).toContain('reservation_id IS NULL')

    // The second binding is refused: the proof already paid for RES_ID.
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [settledRow(null, RES_ID)] })

    await expect(bindSettlementToReservation(key, OTHER_RES_ID)).rejects.toThrow(
      'Payment proof was already used for a different reservation'
    )
  })

  it('rejects a settled proof reused for a different booking hold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [settledRow(HOLD_ID)] })

    await expect(
      settleBookingFee({
        paymentHeader: PROOF,
        amountUsdc: AMOUNT,
        holdId: OTHER_HOLD_ID,
      })
    ).rejects.toThrow('Payment proof was already used for a different hold')

    expect(mockSettleX402Payment).not.toHaveBeenCalled()
  })

  it('never marks a settled receipt as failed', async () => {
    setX402Engine(null)
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT INTO safetrust.x402_settlements')) {
        return { rowCount: 1, rows: [{ id: 'settlement-1', claim_token: 'claim-1' }] }
      }
      if (String(sql).trimStart().toUpperCase().startsWith('SELECT')) {
        return { rows: [] }
      }
      return { rowCount: 1, rows: [] }
    })

    await expect(
      settleBookingFee({ paymentHeader: PROOF, amountUsdc: AMOUNT, holdId: HOLD_ID })
    ).rejects.toThrow('x402 settlement processor is unavailable')

    const failedUpdate = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("SET status = 'failed'")
    )
    expect(failedUpdate).toBeDefined()
    expect(String(failedUpdate?.[0])).toContain("status <> 'settled'")
    // Only the claim that owns the row may record the failure.
    expect(String(failedUpdate?.[0])).toContain('claim_token = $3')
    expect(failedUpdate?.[1]).toEqual([expect.any(String), expect.any(String), 'claim-1'])
  })
})
