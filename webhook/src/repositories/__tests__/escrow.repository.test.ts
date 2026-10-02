import {
  getEscrowByContractId,
  updateEscrowStatus,
  createEscrow,
  approveMilestone,
  approveEscrowStatus,
  fundEscrow,
  releaseFunds,
  disputeEscrow,
  resolveDispute,
  appendResolutionNote,
} from '../escrow.repository'
import { hasuraRequest } from '../../services/hasura'

jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>

describe('escrow.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getEscrowByContractId', () => {
    it('returns typed escrow data when found (happy path)', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        trustless_work_escrows: [
          {
            id: 'escrow-uuid-1',
            contractId: 'contract-123',
            status: 'funded',
            balance: 500,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      })

      const result = await getEscrowByContractId('contract-123')

      expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('GetEscrowByContractId'), {
        contractId: 'contract-123',
      })
      expect(result).toEqual({
        id: 'escrow-uuid-1',
        contractId: 'contract-123',
        status: 'funded',
        balance: 500,
        createdAt: '2026-01-01T00:00:00Z',
      })
    })

    it('returns null when escrow is not found', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        trustless_work_escrows: [],
      })

      const result = await getEscrowByContractId('missing-contract')

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('GetEscrowByContractId'), {
        contractId: 'missing-contract',
      })
      expect(result).toBeNull()
    })
  })

  describe('updateEscrowStatus', () => {
    it('passes correct variables to hasuraRequest', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { affected_rows: 1 },
      })

      await updateEscrowStatus('contract-123', 'completed')

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('UpdateEscrowStatus'), {
        contractId: 'contract-123',
        status: 'completed',
      })
    })
  })

  describe('createEscrow', () => {
    it('creates an escrow record and returns typed escrow data', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        insert_trustless_work_escrows_one: {
          id: 'escrow-uuid-1',
          contractId: 'contract-123',
          status: 'created',
          createdAt: '2026-01-01T00:00:00Z',
        },
      })

      const input = {
        contractId: 'contract-123',
        marker: 'marker-1',
        approver: 'app-1',
        releaser: 'rel-1',
        escrowType: 'single_release',
        status: 'created',
        assetCode: 'USDC',
        amount: 100,
        balance: 0,
        tenantId: 'safetrust',
      }

      const result = await createEscrow(input)

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('InitializeEscrow'), {
        object: input,
      })
      expect(result).toEqual({
        id: 'escrow-uuid-1',
        contractId: 'contract-123',
        status: 'created',
        createdAt: '2026-01-01T00:00:00Z',
      })
    })

    it('returns null when insertion fails', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        insert_trustless_work_escrows_one: null,
      })

      const result = await createEscrow({
        contractId: 'contract-123',
        marker: 'marker-1',
        approver: 'app-1',
        releaser: 'rel-1',
        escrowType: 'single_release',
        status: 'created',
        assetCode: 'USDC',
        amount: 100,
        balance: 0,
        tenantId: 'safetrust',
      })

      expect(result).toBeNull()
    })
  })

  describe('approveMilestone', () => {
    it('returns true when milestone update affects rows', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_escrow_milestones: { affected_rows: 1 },
      })

      const result = await approveMilestone('escrow-1', 'm-1', 'app-1', '2026-01-01')

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('ApproveMilestone'), {
        escrowId: 'escrow-1',
        milestoneId: 'm-1',
        approver: 'app-1',
        approvedAt: '2026-01-01',
      })
      expect(result).toBe(true)
    })

    it('returns false when no milestone is updated', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_escrow_milestones: { affected_rows: 0 },
      })

      const result = await approveMilestone('escrow-1', 'm-1', 'app-1', '2026-01-01')
      expect(result).toBe(false)
    })
  })

  describe('approveEscrowStatus', () => {
    it('returns true when status update affects rows', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { affected_rows: 1 },
      })

      const result = await approveEscrowStatus('escrow-1', '2026-01-01', ['funded'])

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('ApproveEscrow'), {
        escrowId: 'escrow-1',
        approvedAt: '2026-01-01',
        validStates: ['funded'],
      })
      expect(result).toBe(true)
    })
  })

  describe('fundEscrow', () => {
    it('returns updated escrow on successful funding', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: {
          returning: [{ id: 'escrow-1', contractId: 'c-1', status: 'funded', balance: 200 }],
        },
      })

      const result = await fundEscrow('c-1', 200, ['created'])

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('FundEscrow'), {
        contractId: 'c-1',
        amount: 200,
        validStates: ['created'],
      })
      expect(result).toEqual({ id: 'escrow-1', contractId: 'c-1', status: 'funded', balance: 200 })
    })

    it('returns null when no rows returned', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { returning: [] },
      })

      const result = await fundEscrow('c-1', 200, ['created'])
      expect(result).toBeNull()
    })
  })

  describe('releaseFunds', () => {
    it('returns completed escrow data on release', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: {
          returning: [{ id: 'escrow-1', contractId: 'c-1', status: 'completed', balance: 0 }],
        },
      })

      const result = await releaseFunds('c-1')

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('ReleaseFunds'), {
        contractId: 'c-1',
      })
      expect(result).toEqual({ id: 'escrow-1', contractId: 'c-1', status: 'completed', balance: 0 })
    })
  })

  describe('disputeEscrow', () => {
    it('returns disputed escrow data on dispute', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: {
          returning: [{ id: 'escrow-1', contractId: 'c-1', status: 'disputed' }],
        },
      })

      const result = await disputeEscrow('c-1', ['funded'])

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('DisputeEscrow'), {
        contractId: 'c-1',
        validStates: ['funded'],
      })
      expect(result).toEqual({ id: 'escrow-1', contractId: 'c-1', status: 'disputed' })
    })
  })

  describe('resolveDispute', () => {
    it('returns resolved escrow data', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: {
          returning: [{ id: 'escrow-1', contractId: 'c-1', status: 'resolved', balance: 0 }],
        },
      })

      const result = await resolveDispute('c-1', ['disputed'])

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('ResolveDispute'), {
        contractId: 'c-1',
        validStates: ['disputed'],
      })
      expect(result).toEqual({ id: 'escrow-1', contractId: 'c-1', status: 'resolved', balance: 0 })
    })
  })

  describe('appendResolutionNote', () => {
    it('appends note to escrow metadata and returns boolean', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { affected_rows: 1 },
      })

      const note = { resolver: 'r-1', note: 'resolved' }
      const result = await appendResolutionNote('c-1', note)

      expect(mockedHasuraRequest).toHaveBeenCalledWith(expect.stringContaining('AppendResolutionNote'), {
        contractId: 'c-1',
        note,
      })
      expect(result).toBe(true)
    })
  })
})
