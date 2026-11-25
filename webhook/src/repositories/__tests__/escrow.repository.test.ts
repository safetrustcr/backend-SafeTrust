import {
  getEscrowByContractId,
  updateEscrowStatus,
  createEscrow,
  upsertEscrow,
  approveMilestone,
  approveEscrowStatus,
  fundEscrow,
  releaseFunds,
  disputeEscrow,
  resolveDispute,
  appendResolutionNote,
  StateConflictError,
} from '../escrow.repository'
import { query } from '../../db/pool'

jest.mock('../../db/pool', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}))

const mockedQuery = query as jest.MockedFunction<typeof query>

describe('escrow.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getEscrowByContractId', () => {
    it('returns typed escrow data when found (happy path)', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'escrow-uuid-1',
            contract_id: 'contract-123',
            status: 'funded',
            balance: '500',
            created_at: '2026-01-01T00:00:00Z',
            tenant_id: 'safetrust',
          },
        ],
        rowCount: 1,
      } as any)

      const result = await getEscrowByContractId('contract-123')

      expect(mockedQuery).toHaveBeenCalledTimes(1)
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM safetrust.trustless_work_escrows'),
        ['contract-123']
      )
      expect(result).toEqual({
        id: 'escrow-uuid-1',
        contractId: 'contract-123',
        status: 'funded',
        balance: 500,
        createdAt: '2026-01-01T00:00:00Z',
        tenantId: 'safetrust',
      })
    })

    it('returns null when escrow is not found', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      const result = await getEscrowByContractId('missing-contract')

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM safetrust.trustless_work_escrows'),
        ['missing-contract']
      )
      expect(result).toBeNull()
    })
  })

  describe('updateEscrowStatus', () => {
    it('passes validStates when guarded and succeeds', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

      await updateEscrowStatus('contract-123', 'completed', ['milestone_approved'])

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.trustless_work_escrows'),
        ['completed', 'contract-123', ['milestone_approved']]
      )
    })

    it('throws StateConflictError when guarded and 0 rows affected', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      await expect(
        updateEscrowStatus('contract-123', 'completed', ['milestone_approved'])
      ).rejects.toBeInstanceOf(StateConflictError)
    })

    it('throws StateConflictError when empty validStates array is supplied and 0 rows affected', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      await expect(
        updateEscrowStatus('contract-123', 'completed', [])
      ).rejects.toBeInstanceOf(StateConflictError)

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.trustless_work_escrows'),
        ['completed', 'contract-123', []]
      )
    })
  })

  describe('createEscrow & upsertEscrow', () => {
    const payload = {
      contractId: 'contract-123',
      marker: 'GMARKER',
      approver: 'GAPPROVER',
      releaser: 'GRELEASER',
      resolver: null,
      escrowType: 'single_release',
      status: 'created',
      assetCode: 'USDC',
      assetIssuer: null,
      amount: 100,
      balance: 0,
      tenantId: 'safetrust',
      escrowMetadata: { foo: 'bar' },
    }

    it('createEscrow inserts and returns mapped escrow', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'escrow-uuid-1',
            contract_id: 'contract-123',
            status: 'created',
            created_at: '2026-01-01T00:00:00Z',
            tenant_id: 'safetrust',
          },
        ],
        rowCount: 1,
      } as any)

      const result = await createEscrow(payload)

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO safetrust.trustless_work_escrows'),
        expect.arrayContaining(['contract-123', 'safetrust'])
      )
      expect(result).toEqual({
        id: 'escrow-uuid-1',
        contractId: 'contract-123',
        status: 'created',
        createdAt: '2026-01-01T00:00:00Z',
        tenantId: 'safetrust',
      })
    })

    it('upsertEscrow handles ON CONFLICT (contract_id)', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'escrow-uuid-1',
            contract_id: 'contract-123',
            status: 'created',
            created_at: '2026-01-01T00:00:00Z',
            tenant_id: 'safetrust',
          },
        ],
        rowCount: 1,
      } as any)

      const result = await upsertEscrow(payload)

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (contract_id)'),
        expect.arrayContaining(['contract-123', 'safetrust'])
      )
      expect(result?.id).toBe('escrow-uuid-1')
    })
  })

  describe('approveMilestone', () => {
    it('returns true when a milestone row is updated', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

      const updated = await approveMilestone('escrow-1', 'check_in', 'GAPPROVER', '2026-01-01T00:00:00Z')

      expect(updated).toBe(true)
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.escrow_milestones'),
        ['GAPPROVER', '2026-01-01T00:00:00Z', 'escrow-1', 'check_in']
      )
    })

    it('returns false when no milestone row is updated', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      const updated = await approveMilestone('escrow-1', 'missing', 'GAPPROVER', '2026-01-01T00:00:00Z')

      expect(updated).toBe(false)
    })
  })

  describe('approveEscrowStatus', () => {
    it('returns true when escrow status transitions to milestone_approved', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

      const updated = await approveEscrowStatus('escrow-1', '2026-01-01T00:00:00Z', ['funded'])

      expect(updated).toBe(true)
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'milestone_approved'"),
        ['2026-01-01T00:00:00Z', 'escrow-1', ['funded']]
      )
    })
  })

  describe('fundEscrow', () => {
    it('updates balance and status and returns mapped escrow', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'escrow-1', contract_id: 'contract-123', status: 'funded', balance: '250' }],
        rowCount: 1,
      } as any)

      const result = await fundEscrow('contract-123', 250, ['created'])

      expect(result).toEqual({
        id: 'escrow-1',
        contractId: 'contract-123',
        status: 'funded',
        balance: 250,
      })
    })

    it('returns null when no row matches validStates', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      const result = await fundEscrow('contract-123', 250, ['created'])

      expect(result).toBeNull()
    })
  })

  describe('releaseFunds', () => {
    it('transitions to completed and zeroes balance', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'escrow-1', contract_id: 'contract-123', status: 'completed', balance: '0' }],
        rowCount: 1,
      } as any)

      const result = await releaseFunds('contract-123', ['milestone_approved'])

      expect(result).toEqual({
        id: 'escrow-1',
        contractId: 'contract-123',
        status: 'completed',
        balance: 0,
      })
    })

    it('throws StateConflictError when 0 rows updated', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      await expect(releaseFunds('contract-123', ['milestone_approved'])).rejects.toBeInstanceOf(
        StateConflictError
      )
    })
  })

  describe('disputeEscrow & resolveDispute', () => {
    it('disputeEscrow transitions to disputed', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'escrow-1', contract_id: 'contract-123', status: 'disputed' }],
        rowCount: 1,
      } as any)

      const result = await disputeEscrow('contract-123', ['funded'])

      expect(result).toEqual({
        id: 'escrow-1',
        contractId: 'contract-123',
        status: 'disputed',
      })
    })

    it('resolveDispute transitions to resolved and zeroes balance', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: 'escrow-1', contract_id: 'contract-123', status: 'resolved', balance: '0' }],
        rowCount: 1,
      } as any)

      const result = await resolveDispute('contract-123', ['disputed'])

      expect(result).toEqual({
        id: 'escrow-1',
        contractId: 'contract-123',
        status: 'resolved',
        balance: 0,
      })
    })
  })

  describe('appendResolutionNote', () => {
    it('merges jsonb note into escrow_metadata', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

      const updated = await appendResolutionNote('contract-123', { reason: 'settled' })

      expect(updated).toBe(true)
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('escrow_metadata = COALESCE(escrow_metadata'),
        [JSON.stringify({ reason: 'settled' }), 'contract-123']
      )
    })
  })
})
