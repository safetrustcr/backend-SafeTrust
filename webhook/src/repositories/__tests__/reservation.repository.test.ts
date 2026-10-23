import {
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
