import {
  linkEscrowToReservation,
  mirrorReservationStatus,
  mirrorReservationStatusInTransaction,
} from '../reservation.repository'
import { hasuraAdminRequest } from '../../services/hasura'

jest.mock('../../services/hasura', () => ({
  hasuraAdminRequest: jest.fn(),
}))

const mockedHasuraAdminRequest = hasuraAdminRequest as jest.MockedFunction<
  typeof hasuraAdminRequest
>

describe('reservation.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('linkEscrowToReservation', () => {
    it('issues a tenant-scoped update with the session tenant', async () => {
      mockedHasuraAdminRequest.mockResolvedValueOnce({
        update_reservations: {
          returning: [{ id: 'res-1', status: 'escrow_created', escrowId: 'escrow-1' }],
        },
      })

      await linkEscrowToReservation('res-1', 'escrow-1', 'safetrust')

      expect(mockedHasuraAdminRequest).toHaveBeenCalledTimes(1)
      const [tenant, mutation, variables] = mockedHasuraAdminRequest.mock.calls[0]
      expect(tenant).toBe('safetrust')
      expect(mutation).toContain('LinkEscrowToReservation')
      expect(mutation).toContain('tenantId: { _eq: $tenantId }')
      expect(mutation).not.toContain('_by_pk')
      expect(variables).toEqual({
        reservationId: 'res-1',
        escrowId: 'escrow-1',
        tenantId: 'safetrust',
      })
    })

    it('throws when no tenant-scoped reservation row is updated', async () => {
      mockedHasuraAdminRequest.mockResolvedValueOnce({ update_reservations: { returning: [] } })

      await expect(linkEscrowToReservation('res-1', 'escrow-1', 'tenant-a')).rejects.toThrow(
        /no reservation res-1 found for tenant tenant-a/
      )
    })

    it('rejects an empty tenant without calling Hasura', async () => {
      await expect(linkEscrowToReservation('res-1', 'escrow-1', '')).rejects.toThrow(
        /tenantId is required/
      )
      expect(mockedHasuraAdminRequest).not.toHaveBeenCalled()
    })

    it('propagates a tenant mismatch raised by hasuraAdminRequest', async () => {
      mockedHasuraAdminRequest.mockRejectedValueOnce(new Error('Tenant mismatch'))

      await expect(linkEscrowToReservation('res-1', 'escrow-1', 'tenant-a')).rejects.toThrow(
        /Tenant mismatch/
      )
    })
  })

  describe('mirrorReservationStatus', () => {
    it('issues a tenant-scoped status mirror', async () => {
      mockedHasuraAdminRequest.mockResolvedValueOnce({
        update_reservations: { affected_rows: 1, returning: [{ id: 'res-1', status: 'funded' }] },
        linked: { aggregate: { count: 1 } },
      })

      await mirrorReservationStatus('escrow-1', 'funded', 'safetrust')

      const [tenant, mutation, variables] = mockedHasuraAdminRequest.mock.calls[0]
      expect(tenant).toBe('safetrust')
      expect(mutation).toContain('MirrorStatusToReservation')
      expect(mutation).toContain('tenantId: { _eq: $tenantId }')
      expect(variables).toEqual({ escrowId: 'escrow-1', status: 'funded', tenantId: 'safetrust' })
    })

    it('is a no-op when the escrow has no linked reservation', async () => {
      mockedHasuraAdminRequest.mockResolvedValueOnce({
        update_reservations: { affected_rows: 0, returning: [] },
        linked: { aggregate: { count: 0 } },
      })

      await expect(mirrorReservationStatus('escrow-1', 'funded', 'safetrust')).resolves.toBeUndefined()
    })

    it('throws when a linked reservation was not updated in the tenant', async () => {
      mockedHasuraAdminRequest.mockResolvedValueOnce({
        update_reservations: { affected_rows: 0, returning: [] },
        linked: { aggregate: { count: 1 } },
      })

      await expect(mirrorReservationStatus('escrow-1', 'funded', 'tenant-a')).rejects.toThrow(
        /1 reservation\(s\) for escrow escrow-1 were not updated in tenant tenant-a/
      )
    })

    it('rejects an empty tenant without calling Hasura', async () => {
      await expect(mirrorReservationStatus('escrow-1', 'funded', '')).rejects.toThrow(
        /tenantId is required/
      )
      expect(mockedHasuraAdminRequest).not.toHaveBeenCalled()
    })
  })

  describe('mirrorReservationStatusInTransaction', () => {
    it('scopes the update to the escrow owner tenant instead of a literal', async () => {
      const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) }

      await mirrorReservationStatusInTransaction(client as never, 'escrow-1', 'funded')

      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('SELECT e.tenant_id FROM safetrust.trustless_work_escrows e')
      expect(sql).not.toContain("'safetrust'")
      expect(params).toEqual(['funded', 'escrow-1'])
    })
  })
})
