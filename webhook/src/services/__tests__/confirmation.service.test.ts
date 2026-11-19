'use strict'

import {
  verifyStellarTransaction,
  updateTWIndexerFromTxHash,
  sendTransactionViaTWHelper,
  upsertRetryRecord,
  updateRetryRecordStatus,
  promoteEscrowStatus,
  processHelperSubmission,
  processExternalSubmission,
  processPendingConfirmationRetries,
  calculateBackoffMs,
  MAX_ATTEMPTS,
} from '../confirmation.service'
import { assertSignedXdrCannotAdvanceStatus, EscrowValidationError } from '../escrow.service'
import db from '../db'

jest.mock('../db', () => ({
  query: jest.fn(),
}))

const mockedDbQuery = db.query as jest.MockedFunction<typeof db.query>

describe('Confirmation Service - Issue #660', () => {
  const VALID_TX_HASH = 'a'.repeat(64)
  const INVALID_TX_HASH = 'invalid-tx-hash-short'
  const ESCROW_ID = 'contract-escrow-123'

  beforeEach(() => {
    jest.clearAllMocks()
    delete (global as any).fetch
  })

  // ── 1. Signed but unsubmitted ─────────────────────────────────────────────
  describe('Criterion 1: Signed but unsubmitted XDR', () => {
    it('rejects signed-but-unsubmitted XDR and asserts it cannot advance escrow status', () => {
      const signedXdr = 'AAAA_SIGNED_XDR_TEST_WALLET_12345'
      expect(() => {
        assertSignedXdrCannotAdvanceStatus(signedXdr)
      }).toThrow(EscrowValidationError)

      // Verify no DB queries were executed
      expect(mockedDbQuery).not.toHaveBeenCalled()
    })

    it('rejects empty or non-string signed XDR in helper submission without advancing', async () => {
      const result = await processHelperSubmission({
        signedXdr: '',
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
      })

      expect(result.success).toBe(false)
      expect(result.stage).toBe('xdr_issued')
      expect(result.error).toContain('Signed XDR is required')
      expect(mockedDbQuery).not.toHaveBeenCalled()
    })
  })

  // ── 2. Helper submission path (Path A) ────────────────────────────────────
  describe('Criterion 2: Helper submission path (Path A)', () => {
    it('submits signed XDR via helper, verifies ledger, promotes DB to confirmed, and marks retry completed', async () => {
      // Mock fetch: 1st for helper send-transaction, 2nd for Stellar Horizon
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ txHash: VALID_TX_HASH }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ successful: true, ledger: 1234567 }),
        })

      global.fetch = mockFetch

      // Mock DB: 1st upsertRetryRecord, 2nd promote trustless_work_escrows, 3rd promote escrow_transactions, 4th updateRetryRecordStatus
      mockedDbQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'retry-uuid-1',
              txHash: VALID_TX_HASH,
              escrowId: ESCROW_ID,
              action: 'deploy',
              network: 'testnet',
              submissionPath: 'helper',
              status: 'retrying',
            },
          ],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any) // update trustless_work_escrows
        .mockResolvedValueOnce({ rows: [] } as any) // update escrow_transactions
        .mockResolvedValueOnce({ rows: [] } as any) // updateRetryRecordStatus completed

      const result = await processHelperSubmission({
        signedXdr: 'VALID_SIGNED_XDR',
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
      })

      expect(result.success).toBe(true)
      expect(result.stage).toBe('confirmed')
      expect(result.txHash).toBe(VALID_TX_HASH)
      expect(result.ledger).toBe(1234567)
      expect(result.twIndexed).toBe(true)

      // Ensure helper endpoint was called with signedXdr
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/helper/send-transaction'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ signedXdr: 'VALID_SIGNED_XDR', network: 'testnet' }),
        })
      )

      // Ensure Stellar Horizon testnet was queried for verification
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `https://horizon-testnet.stellar.org/transactions/${VALID_TX_HASH}`
      )
    })
  })

  // ── 3. External submission path (Path B) ──────────────────────────────────
  describe('Criterion 3: External submission path (Path B)', () => {
    it('persists txHash immediately, verifies ledger, invokes indexer/update-from-txHash, and promotes DB', async () => {
      // Mock fetch: 1st for Stellar Horizon, 2nd for TW indexer/update-from-txHash
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ successful: true, ledger: 888888 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => 'OK',
        })

      global.fetch = mockFetch

      mockedDbQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'retry-uuid-2',
              txHash: VALID_TX_HASH,
              escrowId: ESCROW_ID,
              action: 'fund',
              network: 'testnet',
              submissionPath: 'external',
              status: 'retrying',
            },
          ],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)

      const result = await processExternalSubmission({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'fund',
        network: 'testnet',
        isTWGenerated: true,
      })

      expect(result.success).toBe(true)
      expect(result.stage).toBe('confirmed')
      expect(result.txHash).toBe(VALID_TX_HASH)
      expect(result.ledger).toBe(888888)
      expect(result.twIndexed).toBe(true)

      // Guardrail check: indexer/update-from-txHash was called
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/indexer/update-from-txHash'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ txHash: VALID_TX_HASH, network: 'testnet' }),
        })
      )
    })

    it('enforces guardrail: rejects non-TW-generated XDR contexts without calling indexer', async () => {
      const mockFetch = jest.fn()
      global.fetch = mockFetch

      const result = await processExternalSubmission({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        isTWGenerated: false,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Guardrail')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ── 4. Invalid confirmations rejected ────────────────────────────────────
  describe('Criterion 4: Rejection of invalid confirmations', () => {
    it('rejects a failed ledger transaction (successful === false)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ successful: false, ledger: 11111 }),
      })

      mockedDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'retry-3' }] } as any) // upsert
        .mockResolvedValueOnce({ rows: [] } as any) // update to dead_letter

      const result = await processExternalSubmission({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        isTWGenerated: true,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Transaction failed on-ledger')
    })

    it('rejects a pending/expired or missing transaction (404 from Horizon)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      mockedDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'retry-4' }] } as any) // upsert
        .mockResolvedValueOnce({ rows: [] } as any) // update retry

      const result = await processExternalSubmission({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        isTWGenerated: true,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('pending, expired, or wrong network')
    })

    it('rejects a wrong-network transaction (querying mainnet Horizon for testnet tx fails)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const verification = await verifyStellarTransaction(VALID_TX_HASH, 'mainnet')
      expect(verification.verified).toBe(false)
      expect(verification.error).toContain('mainnet')
      expect(global.fetch).toHaveBeenCalledWith(
        `https://horizon.stellar.org/transactions/${VALID_TX_HASH}`
      )
    })

    it('rejects invalid or malformed txHash format', async () => {
      const result = await processExternalSubmission({
        txHash: INVALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        isTWGenerated: true,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('64-character hex')
      expect(mockedDbQuery).not.toHaveBeenCalled()
    })
  })

  // ── 5. Deployment vs. Funding separation ──────────────────────────────────
  describe('Criterion 5: Strict separation of Deployment vs Funding', () => {
    it('promotes deployment to created status without setting balance or marking funded', async () => {
      await promoteEscrowStatus(ESCROW_ID, 'deploy', VALID_TX_HASH, 'testnet')

      expect(mockedDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'created'"),
        [VALID_TX_HASH, 'testnet', ESCROW_ID]
      )
      expect(mockedDbQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("status = 'funded'"),
        expect.anything()
      )
    })

    it('promotes funding to funded status and updates balance', async () => {
      await promoteEscrowStatus(ESCROW_ID, 'fund', VALID_TX_HASH, 'testnet')

      expect(mockedDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'funded'"),
        [VALID_TX_HASH, 'testnet', ESCROW_ID]
      )
    })
  })

  // ── 6. Indexing delay & durable retry ─────────────────────────────────────
  describe('Criterion 6: Indexing delay & durable retry mechanism', () => {
    it('calculates bounded exponential backoff', () => {
      expect(calculateBackoffMs(1)).toBe(1000)
      expect(calculateBackoffMs(2)).toBe(2000)
      expect(calculateBackoffMs(3)).toBe(4000)
      expect(calculateBackoffMs(4)).toBe(8000)
      expect(calculateBackoffMs(15)).toBe(300000) // bounded at 5 minutes
    })

    it('schedules retry when TW indexer temporarily fails during external submission', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ successful: true, ledger: 999 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        })

      mockedDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'retry-temp-fail' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)

      const result = await processExternalSubmission({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'fund',
        network: 'testnet',
        isTWGenerated: true,
      })

      expect(result.success).toBe(false)
      expect(result.stage).toBe('ledger_confirmed')
      expect(result.error).toContain('TW indexer returned status 503')

      // Verify retry was updated with status 'retrying' and attempt 1
      expect(mockedDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        ['retrying', 1, expect.stringContaining('503'), expect.any(Number), 'retry-temp-fail']
      )
    })

    it('processes pending retries and completes them when TW indexer recovers', async () => {
      mockedDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'retry-pending-1',
            txHash: VALID_TX_HASH,
            escrowId: ESCROW_ID,
            escrowAction: 'fund',
            network: 'testnet',
            submissionPath: 'external',
            status: 'retrying',
            attemptCount: 1,
            maxAttempts: 5,
          },
        ],
      } as any)

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ successful: true, ledger: 1000 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => 'OK',
        })

      mockedDbQuery
        .mockResolvedValueOnce({ rows: [] } as any) // promote trustless_work_escrows
        .mockResolvedValueOnce({ rows: [] } as any) // promote escrow_transactions
        .mockResolvedValueOnce({ rows: [] } as any) // updateRetryRecordStatus completed

      const summary = await processPendingConfirmationRetries()
      expect(summary.processed).toBe(1)
      expect(summary.succeeded).toBe(1)
      expect(summary.retried).toBe(0)
      expect(summary.deadLettered).toBe(0)
    })

    it('moves retry to dead_letter when max attempts are exceeded', async () => {
      mockedDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'retry-dead-letter-1',
            txHash: VALID_TX_HASH,
            escrowId: ESCROW_ID,
            escrowAction: 'deploy',
            network: 'testnet',
            submissionPath: 'external',
            status: 'retrying',
            attemptCount: 5,
            maxAttempts: 5,
          },
        ],
      } as any)

      mockedDbQuery.mockResolvedValueOnce({ rows: [] } as any) // update to dead_letter

      const summary = await processPendingConfirmationRetries()
      expect(summary.processed).toBe(1)
      expect(summary.deadLettered).toBe(1)
      expect(summary.succeeded).toBe(0)

      expect(mockedDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        ['dead_letter', 5, expect.stringContaining('Exceeded maximum'), 0, 'retry-dead-letter-1']
      )
    })
  })

  // ── 7. Idempotency ────────────────────────────────────────────────────────
  describe('Criterion 7: Strict Idempotency', () => {
    it('uses ON CONFLICT (tx_hash, escrow_action) to guarantee idempotency upon duplicate submissions', async () => {
      mockedDbQuery.mockResolvedValue({
        rows: [
          {
            id: 'retry-idempotent-1',
            txHash: VALID_TX_HASH,
            escrowId: ESCROW_ID,
            action: 'deploy',
            network: 'testnet',
            submissionPath: 'external',
            status: 'retrying',
            attemptCount: 1,
          },
        ],
      } as any)

      const record1 = await upsertRetryRecord({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        submissionPath: 'external',
      })

      const record2 = await upsertRetryRecord({
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        submissionPath: 'external',
      })

      expect(record1.txHash).toBe(record2.txHash)
      expect(mockedDbQuery).toHaveBeenCalledTimes(2)
      expect(mockedDbQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (tx_hash, escrow_action)'),
        expect.anything()
      )
    })
  })
})
