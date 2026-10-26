import {
  createReservation,
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

  describe('createReservation', () => {
    it('inserts with the metadata-defined GraphQL contract and maps the result', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        insert_safetrust_reservations_one: {
          id: 'res-1',
          apartmentId: 'apt-1',
          guestId: 'guest-1',
          status: 'pending',
          checkInDate: '2026-09-01',
          checkOutDate: '2026-09-05',
          totalAmount: 500,
          assetCode: 'USDC',
          escrowId: null,
          createdAt: '2026-08-24T00:00:00Z',
          tenantId: 'safetrust',
        },
      })

      const result = await createReservation({
        apartmentId: 'apt-1',
        guestId: 'guest-1',
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-05',
        totalAmount: 500,
        assetCode: 'USDC',
      })

      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('insert_safetrust_reservations_one'),
        {
          object: {
            apartmentId: 'apt-1',
            guestId: 'guest-1',
            checkInDate: '2026-09-01',
            checkOutDate: '2026-09-05',
            totalAmount: 500,
            assetCode: 'USDC',
            status: 'pending',
            tenantId: 'safetrust',
          },
        }
      )
      expect(result).toEqual({
        id: 'res-1',
        apartment_id: 'apt-1',
        guest_id: 'guest-1',
        status: 'pending',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
        asset_code: 'USDC',
        escrow_id: null,
        created_at: '2026-08-24T00:00:00Z',
        tenant_id: 'safetrust',
      })
    })

    it('returns null when Hasura does not return an inserted reservation', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        insert_safetrust_reservations_one: null,
      })

      const result = await createReservation({
        apartmentId: 'apt-1',
        guestId: 'guest-1',
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-05',
        totalAmount: 500,
        assetCode: 'USDC',
      })

      expect(result).toBeNull()
    })
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

    it('uses the provided transaction client instead of Hasura', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rowCount: 1 }),
      }

      await mirrorReservationStatus('escrow-1', 'funded', 'safetrust', mockClient)

      expect(mockClient.query).toHaveBeenCalledTimes(1)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.reservations'),
        ['funded', 'escrow-1', 'safetrust']
      )
      expect(mockedHasuraRequest).not.toHaveBeenCalled()
    })
  })
})
