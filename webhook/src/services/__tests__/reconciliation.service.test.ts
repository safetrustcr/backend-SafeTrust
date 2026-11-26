'use strict'

import db from '../db'
import {
  fetchEscrowsByContractIds,

} from '../../lib/source-adapters/tw.adapter'

import * as reconciliationRepository from '../../repositories/reconciliation.repository'

import {
  fetchEscrowContractIds,
  syncEscrowsWithIndexer,
  syncAllChunks,
  CHUNK_SIZE,
  detectStaleEscrows,
  formatReconciliationSummary,
  SyncSummary,
} from '../reconciliation.service'

jest.mock('../db', () => ({
  query: jest.fn(),
}))

jest.mock('../../lib/source-adapters/tw.adapter', () => ({

  fetchEscrowsByContractIds: jest.fn(),

}))

describe('reconciliation.service', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
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

      expect(fetchEscrowsByContractIds).not.toHaveBeenCalled()

      expect(result).toEqual({
        totalEscrows: 0,
        chunks: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        errors: [],
      })
    })

    it('fetches and upserts escrow chunks when contract IDs are present', async () => {

      ;(fetchEscrowsByContractIds as jest.Mock).mockResolvedValueOnce([

        { contractId: 'c1' },

      ])

      const upsertEscrows = jest

        .spyOn(reconciliationRepository, 'upsertEscrows')

        .mockResolvedValueOnce({

          updated: 10,

          unchanged: 85,

          skipped: 5,

        })


      const contractIds = ['c1', 'c2', 'c3']
      const result = await syncEscrowsWithIndexer(contractIds)

      expect(fetchEscrowsByContractIds).toHaveBeenCalledWith(contractIds)

      // Raw indexer rows are normalized before the write (tw-indexer.normalize.ts).
      expect(upsertEscrows).toHaveBeenCalledWith([
        expect.objectContaining({ contractId: 'c1', status: 'created', escrowType: 'single_release' }),
      ])

      expect(result).toEqual({
        totalEscrows: 3,
        chunks: 1,

        updated: 10,
        unchanged: 85,
        skipped: 5,
        errors: [],
      })
    })

    it('includes chunk errors in the summary', async () => {
      ;(fetchEscrowsByContractIds as jest.Mock).mockRejectedValueOnce(

        new Error('connection timeout')

      )


      const result = await syncEscrowsWithIndexer(['c1'])

      expect(result.errors).toEqual(['chunk_0: connection timeout'])
      expect(result.totalEscrows).toBe(1)
    })

    it('reports database write errors as chunk errors', async () => {

      ;(fetchEscrowsByContractIds as jest.Mock).mockResolvedValueOnce([

        { contractId: 'c1' },

      ])

      jest

        .spyOn(reconciliationRepository, 'upsertEscrows')

        .mockRejectedValueOnce(new Error('database write failed'))



      const result = await syncEscrowsWithIndexer(['c1'])


      expect(result.errors).toEqual(['chunk_0: database write failed'])

    })
  })

  // ─── 3. syncAllChunks ──────────────────────────────────────────────────────
  describe('syncAllChunks', () => {
    it('fetches every chunk in turn and keeps going after a failed chunk', async () => {
      const ids = Array.from({ length: CHUNK_SIZE * 2 + 1 }, (_, i) => `c${i}`)
      const calls: string[][] = []
      ;(fetchEscrowsByContractIds as jest.Mock).mockImplementation(async (chunk: string[]) => {
        calls.push(chunk)
        if (calls.length === 2) throw new Error('indexer 503')
        return []
      })
      jest
        .spyOn(reconciliationRepository, 'upsertEscrows')
        .mockResolvedValue({ updated: 0, unchanged: 0, skipped: 0 })

      const result = await syncAllChunks(ids)

      expect(calls.map((chunk) => chunk.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1])
      expect(calls.flat()).toEqual(ids)
      expect(result).toEqual({
        chunks: 3,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        errors: ['chunk_1: indexer 503'],
      })
    })

    it('does not start the next chunk before the current one finishes', async () => {
      const ids = Array.from({ length: CHUNK_SIZE * 3 }, (_, i) => `c${i}`)
      let inFlight = 0
      let maxInFlight = 0
      ;(fetchEscrowsByContractIds as jest.Mock).mockImplementation(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setImmediate(resolve))
        inFlight--
        return []
      })
      jest
        .spyOn(reconciliationRepository, 'upsertEscrows')
        .mockResolvedValue({ updated: 0, unchanged: 0, skipped: 0 })

      await syncAllChunks(ids)

      expect(fetchEscrowsByContractIds).toHaveBeenCalledTimes(3)
      expect(maxInFlight).toBe(1)
    })
  })

  // ─── 4. detectStaleEscrows ─────────────────────────────────────────────────
  describe('detectStaleEscrows', () => {
    it('calls findStaleEscrows with default 7 days and returns stale IDs', async () => {
      jest

        .spyOn(reconciliationRepository, 'findStaleEscrows')

        .mockResolvedValueOnce(['stale_1', 'stale_2'])


      const result = await detectStaleEscrows()

      expect(reconciliationRepository.findStaleEscrows).toHaveBeenCalledWith(7)

      expect(result).toEqual(['stale_1', 'stale_2'])
    })

    it('calls findStaleEscrows with custom days parameter', async () => {
      jest

        .spyOn(reconciliationRepository, 'findStaleEscrows')

        .mockResolvedValueOnce(['stale_old'])


      const result = await detectStaleEscrows(30)

      expect(reconciliationRepository.findStaleEscrows).toHaveBeenCalledWith(30)

      expect(result).toEqual(['stale_old'])
    })

    it('handles empty stale list', async () => {
      jest

        .spyOn(reconciliationRepository, 'findStaleEscrows')

        .mockResolvedValueOnce([])


      const result = await detectStaleEscrows()
      expect(result).toEqual([])
    })

    it('handles undefined return gracefully', async () => {
      const staleEscrows = jest.spyOn(

        reconciliationRepository,

        'findStaleEscrows'

      )

      ;(staleEscrows as jest.Mock).mockResolvedValueOnce(undefined)


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

    it('is a pure function that does not mutate its inputs', () => {
      const syncInput = { ...syncSample, errors: [...syncSample.errors] }
      const staleInput = ['stale_1', 'stale_2']

      const syncSnapshot = JSON.stringify(syncInput)
      const staleSnapshot = JSON.stringify(staleInput)

      const response = formatReconciliationSummary(syncInput, staleInput, 150)

      expect(JSON.stringify(syncInput)).toBe(syncSnapshot)
      expect(JSON.stringify(staleInput)).toBe(staleSnapshot)
      expect(response).toBeDefined()
    })

    it('formats normal reconciliation results into expected response structure', () => {
      const stale = ['stale_1', 'stale_2']
      const response = formatReconciliationSummary(syncSample, stale, 250)

      expect(response).toEqual({
        success: true,
        totalEscrows: 5,
        chunks: 1,
        updated: 2,
        unchanged: 3,
        skipped: 0,
        staleCount: 2,
        staleContractIds: ['stale_1', 'stale_2'],
        errors: 1,
        durationMs: 250,
      })
      expect(response.message).toBeUndefined()
    })

    it('includes transition failures in the aggregate error count', () => {
      const syncWithTransitions: SyncSummary = {
        ...syncSample,
        transitions: {
          detected: 1,
          applied: 0,
          duplicates: 0,
          failed: 1,
          errors: ['C-BAD: mirror unavailable'],
          failedContractIds: ['C-BAD'],
        },
      }

      const response = formatReconciliationSummary(syncWithTransitions, [], 250)

      expect(response.errors).toBe(2)
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
      const response = formatReconciliationSummary(emptySync, [], 10)

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
        durationMs: 10,
      })

    })

    it('slices staleContractIds to at most 10 items', () => {
      const manyStale = Array.from({ length: 25 }, (_, i) => `stale_${i + 1}`)

      const response = formatReconciliationSummary(
        syncSample,
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
