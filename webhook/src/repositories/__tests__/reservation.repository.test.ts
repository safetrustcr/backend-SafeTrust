import {
  createReservation,
  linkEscrowToReservation,
  mirrorReservationStatus,
  mirrorReservationStatusInTransaction,
} from '../reservation.repository'
import { query } from '../../db/pool'
import { TenantMismatchError } from '../../utils/errors'
import { PoolClient } from 'pg'

jest.mock('../../db/pool', () => ({
  query: jest.fn(),
}))

const mockedQuery = query as jest.MockedFunction<typeof query>

describe('reservation.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createReservation', () => {
    it('inserts into safetrust.reservations with SQL and maps the result', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
        rowCount: 1,
      } as any)

      const result = await createReservation({
        tenantId: 'safetrust',
        apartmentId: 'apt-1',
        guestId: 'guest-1',
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-05',
        totalAmount: 500,
        assetCode: 'USDC',
      })

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO safetrust.reservations'),
        [
          'safetrust',
          'apt-1',
          'guest-1',
          '2026-09-01',
          '2026-09-05',
          500,
          'USDC',
        ]
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

    it('returns null when PostgreSQL does not return an inserted reservation', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      const result = await createReservation({
        tenantId: 'safetrust',
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
    it('links the reservation with a tenant-scoped SQL update', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

      await linkEscrowToReservation('res-1', 'escrow-1', 'safetrust')

      expect(mockedQuery).toHaveBeenCalledTimes(1)
      const [sql, params] = mockedQuery.mock.calls[0]
      expect(sql).toContain('UPDATE safetrust.reservations')
      expect(sql).toContain('AND tenant_id = $3')
      expect(params).toEqual(['escrow-1', 'res-1', 'safetrust'])
    })

    it('throws when no reservation in the tenant matches', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

      await expect(
        linkEscrowToReservation('res-other-tenant', 'escrow-1', 'safetrust')
      ).rejects.toThrow('Reservation res-other-tenant was not linked')
    })

    it('rejects an empty tenant before querying PostgreSQL', async () => {
      await expect(linkEscrowToReservation('res-1', 'escrow-1', '')).rejects.toBeInstanceOf(
        TenantMismatchError
      )
      expect(mockedQuery).not.toHaveBeenCalled()
    })
  })

  describe('mirrorReservationStatus', () => {
    it('mirrors the status with a tenant-scoped SQL update', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

      await mirrorReservationStatus('escrow-1', 'funded', 'safetrust')

      expect(mockedQuery).toHaveBeenCalledTimes(1)
      const [sql, params] = mockedQuery.mock.calls[0]
      expect(sql).toContain('UPDATE safetrust.reservations')
      expect(sql).toContain('AND tenant_id = $3')
      expect(params).toEqual(['funded', 'escrow-1', 'safetrust'])
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

    it('uses the provided transaction client instead of pool query', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rowCount: 1 }),
      }

      await mirrorReservationStatus('escrow-1', 'funded', 'safetrust', mockClient)

      expect(mockClient.query).toHaveBeenCalledTimes(1)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.reservations'),
        ['funded', 'escrow-1', 'safetrust']
      )
      expect(mockedQuery).not.toHaveBeenCalled()
    })
  })
})
