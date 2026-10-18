'use strict'

import db from '../db'
import { hasuraRequest } from '../hasura'
import {
  syncAllChunks,
  chunkArray,
  findStaleEscrows,
} from '../../lib/reconciliation'
import {
  fetchEscrowContractIds,
  syncEscrowsWithIndexer,
  validateSorobanDrift,
  detectStaleEscrows,
  formatReconciliationSummary,
  runSorobanValidation,
  setSorobanReconcilerAddon,
  SyncSummary,
  DriftSummary,
} from '../reconciliation.service'

jest.mock('../db', () => ({
  query: jest.fn(),
}))

jest.mock('../hasura', () => ({
  hasuraRequest: jest.fn(),
}))

jest.mock('../../lib/reconciliation', () => ({
  chunkArray: jest.fn((arr, size) => {
    const chunks = []
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size))
    }
    return chunks
  }),
  syncAllChunks: jest.fn(),
  findStaleEscrows: jest.fn(),
  CHUNK_SIZE: 50,
}))

describe('reconciliation.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setSorobanReconcilerAddon(null)
    process.env.SOROBAN_VALIDATION_ENABLED = 'false'
  })

  // ─── 1. fetchEscrowContractIds ─────────────────────────────────────────────
  describe('fetchEscrowContractIds', () => {
    it('fetches contract IDs for default tenant "safetrust"', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ contract_id: 'contract_1' }, { contract_id: 'contract_2' }],
      })

      const result = await fetchEscrowContractIds()

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        ['safetrust']
      )
      expect(result).toEqual(['contract_1', 'contract_2'])
    })

    it('fetches contract IDs for custom tenant', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ contract_id: 'other_contract' }],
      })

      const result = await fetchEscrowContractIds('custom_tenant')

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        ['custom_tenant']
      )
      expect(result).toEqual(['other_contract'])
    })

    it('returns empty array when no rows found', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({ rows: [] })

      const result = await fetchEscrowContractIds()
      expect(result).toEqual([])
    })

    it('propagates DB query errors', async () => {
      ;(db.query as jest.Mock).mockRejectedValueOnce(new Error('DB failure'))

      await expect(fetchEscrowContractIds()).rejects.toThrow('DB failure')
    })
  })

  // ─── 2. syncEscrowsWithIndexer ─────────────────────────────────────────────
  describe('syncEscrowsWithIndexer', () => {
    it('returns zero summary immediately when contractIds array is empty', async () => {
      const result = await syncEscrowsWithIndexer([])

      expect(syncAllChunks).not.toHaveBeenCalled()
      expect(result).toEqual({
        totalEscrows: 0,
        chunks: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        errors: [],
      })
    })

    it('calls syncAllChunks and maps results when contractIds are present', async () => {
      ;(syncAllChunks as jest.Mock).mockResolvedValueOnce({
        chunks: 2,
        updated: 10,
        unchanged: 85,
        skipped: 5,
        errors: [],
      })

      const contractIds = ['c1', 'c2', 'c3']
      const result = await syncEscrowsWithIndexer(contractIds)

      expect(syncAllChunks).toHaveBeenCalledWith(contractIds)
      expect(result).toEqual({
        totalEscrows: 3,
        chunks: 2,
        updated: 10,
        unchanged: 85,
        skipped: 5,
        errors: [],
      })
    })

    it('includes chunk errors in the summary', async () => {
      ;(syncAllChunks as jest.Mock).mockResolvedValueOnce({
        chunks: 1,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        errors: ['chunk_0: connection timeout'],
      })

      const result = await syncEscrowsWithIndexer(['c1'])

      expect(result.errors).toEqual(['chunk_0: connection timeout'])
      expect(result.totalEscrows).toBe(1)
    })

    it('propagates unhandled errors from syncAllChunks', async () => {
      ;(syncAllChunks as jest.Mock).mockRejectedValueOnce(new Error('Fatal indexer crash'))

      await expect(syncEscrowsWithIndexer(['c1'])).rejects.toThrow('Fatal indexer crash')
    })
  })

  // ─── 3. validateSorobanDrift & runSorobanValidation ────────────────────────
  describe('validateSorobanDrift', () => {
    it('returns disabled summary when SOROBAN_VALIDATION_ENABLED is false', async () => {
      process.env.SOROBAN_VALIDATION_ENABLED = 'false'

      const result = await validateSorobanDrift(['c1', 'c2'], 'testnet')

      expect(db.query).not.toHaveBeenCalled()
      expect(result).toEqual({
        enabled: false,
        drift: 0,
        corrected: 0,
        errors: [],
      })
    })

    it('returns enabled but zero summary when contractIds is empty', async () => {
      process.env.SOROBAN_VALIDATION_ENABLED = 'true'

      const result = await validateSorobanDrift([], 'testnet')

      expect(db.query).not.toHaveBeenCalled()
      expect(result).toEqual({
        enabled: true,
        drift: 0,
        corrected: 0,
        errors: [],
      })
    })

    it('captures chunk error when soroban native addon is unavailable', async () => {
      process.env.SOROBAN_VALIDATION_ENABLED = 'true'
      setSorobanReconcilerAddon(null)

      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ contract_id: 'c1', status: 'ACTIVE', balance: '100' }],
      })

      const result = await validateSorobanDrift(['c1'], 'testnet')

      expect(result.enabled).toBe(true)
      expect(result.drift).toBe(0)
      expect(result.corrected).toBe(0)
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]).toContain('soroban_chunk_1: soroban-reconciler native addon is not available')
    })

    it('validates drift and auto-corrects critical discrepancies when addon is present', async () => {
      process.env.SOROBAN_VALIDATION_ENABLED = 'true'

      const mockQueryEscrowStateBatch = jest.fn().mockReturnValue(
        JSON.stringify({
          status: 'COMPLETED',
          balance: 0,
        })
      )

      const mockReconcileBatch = jest.fn().mockReturnValue(
        JSON.stringify({
          in_sync: false,
          discrepancies: [
            {
              field: 'status',
              severity: 'critical',
              in_database: 'ACTIVE',
              on_chain: 'COMPLETED',
            },
          ],
        })
      )

      setSorobanReconcilerAddon({
        queryEscrowStateBatch: mockQueryEscrowStateBatch,
        reconcileBatch: mockReconcileBatch,
      })

      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            contract_id: 'c1',
            status: 'ACTIVE',
            balance: '10000000',
            marker: 'm',
            approver: 'a',
          },
        ],
      })
      ;(hasuraRequest as jest.Mock).mockResolvedValueOnce({ affected_rows: 1 })

      const result = await validateSorobanDrift(['c1'], 'testnet')

      expect(mockQueryEscrowStateBatch).toHaveBeenCalledWith('c1', 'testnet')
      expect(hasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation CorrectDriftFromSoroban'),
        {
          contractId: 'c1',
          status: 'COMPLETED',
          balance: 0,
        }
      )
      expect(result).toEqual({
        enabled: true,
        drift: 1,
        corrected: 1,
        errors: [],
      })
    })

    it('does not auto-correct when discrepancy severity is non-critical', async () => {
      process.env.SOROBAN_VALIDATION_ENABLED = 'true'

      setSorobanReconcilerAddon({
        queryEscrowStateBatch: jest.fn().mockReturnValue(
          JSON.stringify({ status: 'ACTIVE', balance: 100 })
        ),
        reconcileBatch: jest.fn().mockReturnValue(
          JSON.stringify({
            in_sync: false,
            discrepancies: [
              {
                field: 'marker',
                severity: 'warning',
                in_database: 'm1',
                on_chain: 'm2',
              },
            ],
          })
        ),
      })

      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ contract_id: 'c1', status: 'ACTIVE', balance: '100' }],
      })

      const result = await validateSorobanDrift(['c1'], 'testnet')

      expect(hasuraRequest).not.toHaveBeenCalled()
      expect(result.drift).toBe(1)
      expect(result.corrected).toBe(0)
    })
  })

  describe('runSorobanValidation', () => {
    it('throws error when addon is not available', async () => {
      setSorobanReconcilerAddon(null)

      await expect(
        runSorobanValidation(['c1'], {}, 'testnet')
      ).rejects.toThrow('soroban-reconciler native addon is not available')
    })

    it('skips contract if not found in dbStateMap', async () => {
      const mockQuery = jest.fn().mockReturnValue(JSON.stringify({ status: 'ACTIVE', balance: 100 }))
      const mockReconcile = jest.fn()

      setSorobanReconcilerAddon({
        queryEscrowStateBatch: mockQuery,
        reconcileBatch: mockReconcile,
      })

      const result = await runSorobanValidation(['c1'], {}, 'testnet')

      expect(mockQuery).toHaveBeenCalledWith('c1', 'testnet')
      expect(mockReconcile).not.toHaveBeenCalled()
      expect(result).toEqual({ drifted: 0, corrected: 0 })
    })

    it('handles per-contract errors gracefully without crashing the chunk', async () => {
      setSorobanReconcilerAddon({
        queryEscrowStateBatch: jest.fn().mockImplementation(() => {
          throw new Error('RPC error')
        }),
        reconcileBatch: jest.fn(),
      })

      const result = await runSorobanValidation(
        ['c1'],
        { c1: { contract_id: 'c1' } },
        'testnet'
      )

      expect(result).toEqual({ drifted: 0, corrected: 0 })
    })
  })

  // ─── 4. detectStaleEscrows ─────────────────────────────────────────────────
  describe('detectStaleEscrows', () => {
    it('calls findStaleEscrows with default 7 days and returns stale IDs', async () => {
      ;(findStaleEscrows as jest.Mock).mockResolvedValueOnce(['stale_1', 'stale_2'])

      const result = await detectStaleEscrows()

      expect(findStaleEscrows).toHaveBeenCalledWith(7)
      expect(result).toEqual(['stale_1', 'stale_2'])
    })

    it('calls findStaleEscrows with custom days parameter', async () => {
      ;(findStaleEscrows as jest.Mock).mockResolvedValueOnce(['stale_old'])

      const result = await detectStaleEscrows(30)

      expect(findStaleEscrows).toHaveBeenCalledWith(30)
      expect(result).toEqual(['stale_old'])
    })

    it('handles empty stale list', async () => {
      ;(findStaleEscrows as jest.Mock).mockResolvedValueOnce([])

      const result = await detectStaleEscrows()
      expect(result).toEqual([])
    })

    it('handles undefined return gracefully', async () => {
      ;(findStaleEscrows as jest.Mock).mockResolvedValueOnce(undefined)

      const result = await detectStaleEscrows()
      expect(result).toEqual([])
    })
  })

  // ─── 5. formatReconciliationSummary (pure function) ─────────────────────────
  describe('formatReconciliationSummary', () => {
    const syncSample: SyncSummary = {
      totalEscrows: 5,
      chunks: 1,
      updated: 2,
      unchanged: 3,
      skipped: 0,
      errors: ['chunk_0: error 1'],
    }

    const driftSample: DriftSummary = {
      enabled: true,
      drift: 1,
      corrected: 1,
      errors: ['soroban_chunk_1: timeout'],
    }

    it('is a pure function that does not mutate its inputs', () => {
      const syncInput = { ...syncSample, errors: [...syncSample.errors] }
      const driftInput = { ...driftSample, errors: [...driftSample.errors] }
      const staleInput = ['stale_1', 'stale_2']

      const syncSnapshot = JSON.stringify(syncInput)
      const driftSnapshot = JSON.stringify(driftInput)
      const staleSnapshot = JSON.stringify(staleInput)

      const response = formatReconciliationSummary(syncInput, driftInput, staleInput, 150)

      expect(JSON.stringify(syncInput)).toBe(syncSnapshot)
      expect(JSON.stringify(driftInput)).toBe(driftSnapshot)
      expect(JSON.stringify(staleInput)).toBe(staleSnapshot)
      expect(response).toBeDefined()
    })

    it('formats normal reconciliation results into expected response structure', () => {
      const stale = ['stale_1', 'stale_2']
      const response = formatReconciliationSummary(syncSample, driftSample, stale, 250)

      expect(response).toEqual({
        success: true,
        totalEscrows: 5,
        chunks: 1,
        updated: 2,
        unchanged: 3,
        skipped: 0,
        staleCount: 2,
        staleContractIds: ['stale_1', 'stale_2'],
        errors: 2, // 1 from sync + 1 from drift
        sorobanEnabled: true,
        sorobanDrift: 1,
        sorobanCorrected: 1,
        durationMs: 250,
      })
      expect(response.message).toBeUndefined()
    })

    it('adds message "No escrows to sync" when totalEscrows is 0', () => {
      const emptySync: SyncSummary = {
        totalEscrows: 0,
        chunks: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        errors: [],
      }
      const emptyDrift: DriftSummary = {
        enabled: false,
        drift: 0,
        corrected: 0,
        errors: [],
      }

      const response = formatReconciliationSummary(emptySync, emptyDrift, [], 10)

      expect(response).toEqual({
        success: true,
        message: 'No escrows to sync',
        totalEscrows: 0,
        chunks: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        staleCount: 0,
        staleContractIds: [],
        errors: 0,
        sorobanEnabled: false,
        sorobanDrift: 0,
        sorobanCorrected: 0,
        durationMs: 10,
      })
    })

    it('slices staleContractIds to at most 10 items', () => {
      const manyStale = Array.from({ length: 25 }, (_, i) => `stale_${i + 1}`)

      const response = formatReconciliationSummary(
        syncSample,
        { enabled: false, drift: 0, corrected: 0, errors: [] },
        manyStale,
        100
      )

      expect(response.staleCount).toBe(25)
      expect(response.staleContractIds.length).toBe(10)
      expect(response.staleContractIds).toEqual([
        'stale_1',
        'stale_2',
        'stale_3',
        'stale_4',
        'stale_5',
        'stale_6',
        'stale_7',
        'stale_8',
        'stale_9',
        'stale_10',
      ])
    })
  })
})
