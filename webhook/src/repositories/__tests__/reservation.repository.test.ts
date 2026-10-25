import {
  linkEscrowToReservation,
  mirrorReservationStatus,
  mirrorReservationStatusInTransaction,
} from '../reservation.repository'
import { hasuraRequest } from '../../services/hasura'
import { TenantMismatchError } from '../../services/tenant-scoped-hasura'
import { PoolClient } from 'pg'

jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>

describe('reservation.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('linkEscrowToReservation', () => {
    it('links the reservation with a tenant-scoped update', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_reservations: { affected_rows: 1 },
      })

      await linkEscrowToReservation('res-1', 'escrow-1', 'safetrust')

      expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
      const [mutation, variables] = mockedHasuraRequest.mock.calls[0]
      expect(mutation).toContain('LinkEscrowToReservation')
      expect(mutation).toContain('tenantId: { _eq: $tenantId }')
      expect(variables).toEqual({
        reservationId: 'res-1',
        escrowId: 'escrow-1',
        tenantId: 'safetrust',
      })
    })

    it('throws when no reservation in the tenant matches', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_reservations: { affected_rows: 0 },
      })

      await expect(
        linkEscrowToReservation('res-other-tenant', 'escrow-1', 'safetrust')
      ).rejects.toThrow('Reservation res-other-tenant was not linked')
    })

    it('rejects an empty tenant before calling Hasura', async () => {
      await expect(linkEscrowToReservation('res-1', 'escrow-1', '')).rejects.toBeInstanceOf(
        TenantMismatchError
      )
      expect(mockedHasuraRequest).not.toHaveBeenCalled()
    })
  })

  describe('mirrorReservationStatus', () => {
    it('mirrors the status with a tenant-scoped update', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_reservations: { returning: [{ id: 'res-1', status: 'funded' }] },
      })

      await mirrorReservationStatus('escrow-1', 'funded', 'safetrust')

      expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
      const [mutation, variables] = mockedHasuraRequest.mock.calls[0]
      expect(mutation).toContain('MirrorStatusToReservation')
      expect(mutation).toContain('tenantId: { _eq: $tenantId }')
      expect(variables).toEqual({
        escrowId: 'escrow-1',
        status: 'funded',
        tenantId: 'safetrust',
      })
    })
  })

  describe('mirrorReservationStatusInTransaction', () => {
    it('binds the tenant as a query parameter instead of a literal', async () => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) }

      await mirrorReservationStatusInTransaction(
        client as unknown as PoolClient,
        'escrow-1',
        'funded',
        'safetrust'
      )

      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('tenant_id = $3')
      expect(sql).not.toContain("'safetrust'")
      expect(params).toEqual(['funded', 'escrow-1', 'safetrust'])
    })
  })
})
