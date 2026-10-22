import {
  createReservation,
  linkEscrowToReservation,
  mirrorReservationStatus,
} from '../reservation.repository'
import { hasuraRequest } from '../../services/hasura'

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
    it('passes correct variables to link escrow to reservation', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_reservations_by_pk: {
          id: 'res-1',
          status: 'escrow_created',
          escrowId: 'escrow-1',
        },
      })

      await linkEscrowToReservation('res-1', 'escrow-1')

      expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('LinkEscrowToReservation'),
        {
          reservationId: 'res-1',
          escrowId: 'escrow-1',
        }
      )
    })
  })

  describe('mirrorReservationStatus', () => {
    it('passes correct variables to mirror reservation status', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_reservations: { returning: [{ id: 'res-1', status: 'funded' }] },
      })

      await mirrorReservationStatus('escrow-1', 'funded')

      expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('MirrorStatusToReservation'),
        {
          escrowId: 'escrow-1',
          status: 'funded',
        }
      )
    })
  })
})
