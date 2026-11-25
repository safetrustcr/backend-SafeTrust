const mockQuery = jest.fn()

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
  query: (...args: unknown[]) => mockQuery(...args),
}))

const mockSettleX402Payment = jest.fn()

import { settleBookingFee, settlementIdempotencyKey } from '../x402-settlement.service'
import { setX402Addon } from '../../middleware/x402-payment.middleware'

const HOLD_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_HOLD_ID = '33333333-3333-4333-8333-333333333333'
const PROOF = 'x402-signed-proof'
const AMOUNT = 0.1

function settledRow(holdId: string | null) {
  return {
    status: 'settled',
    tx_hash: 'settled-tx-hash',
    hold_id: holdId,
    updated_at: new Date(),
  }
}

describe('x402 settlement service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setX402Addon({
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
    })
    expect(mockSettleX402Payment).not.toHaveBeenCalled()
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
    setX402Addon(null)
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT INTO safetrust.x402_settlements')) {
        return { rowCount: 1, rows: [{ id: 'settlement-1' }] }
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
  })
})
