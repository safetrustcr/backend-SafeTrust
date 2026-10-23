import { getApartmentWithOwnerWallet } from '../apartment.repository'
import { hasuraRequest } from '../../services/hasura'

jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>

describe('apartment.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getApartmentWithOwnerWallet', () => {
    it('returns apartment with owner wallet when found (happy path)', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        apartments_by_pk: {
          id: 'apt-uuid-1',
          name: 'Seaside Villa',
          owner_id: 'user-123',
          owner_wallet: 'GBC123XYZ456',
        },
      })

      const result = await getApartmentWithOwnerWallet('apt-uuid-1')

      expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('GetApartmentWithOwnerWallet'),
        { apartmentId: 'apt-uuid-1' }
      )
      expect(result).toEqual({
        id: 'apt-uuid-1',
        name: 'Seaside Villa',
        owner_id: 'user-123',
        ownerWallet: 'GBC123XYZ456',
      })
    })

    it('returns null when apartment is not found', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        apartments_by_pk: null,
      })

      const result = await getApartmentWithOwnerWallet('missing-apt')

      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('GetApartmentWithOwnerWallet'),
        { apartmentId: 'missing-apt' }
      )
      expect(result).toBeNull()
    })

    it('handles null owner_wallet correctly', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        apartments_by_pk: {
          id: 'apt-uuid-2',
          name: 'Mountain Cabin',
          owner_id: 'user-456',
          owner_wallet: null,
        },
      })

      const result = await getApartmentWithOwnerWallet('apt-uuid-2')

      expect(result).toEqual({
        id: 'apt-uuid-2',
        name: 'Mountain Cabin',
        owner_id: 'user-456',
        ownerWallet: null,
      })
    })
  })
})
