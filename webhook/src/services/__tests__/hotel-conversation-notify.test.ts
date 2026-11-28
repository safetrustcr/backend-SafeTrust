import { resolveHotelEscrowParties } from '../hotel-conversation-notify'
import { hotelQuery } from '../db'

jest.mock('../db', () => ({
  hotelQuery: jest.fn(),
  query: jest.fn(),
}))
jest.mock('../hotel-conversation.service', () => ({
  sendHotelConversationMessage: jest.fn(),
}))

const mockedHotelQuery = hotelQuery as jest.MockedFunction<typeof hotelQuery>

describe('resolveHotelEscrowParties', () => {
  beforeEach(() => jest.clearAllMocks())

  it('resolves parties with one query on the hotel_industry database, never naming safetrust', async () => {
    mockedHotelQuery.mockResolvedValueOnce({
      rows: [{
        reservation_id: 'res-1',
        escrow_transaction_id: 'esc-1',
        apartment_id: 'room-1',
        host_id: 'host-1',
        guest_id: 'guest-1',
      }],
    } as never)

    await expect(resolveHotelEscrowParties('C123')).resolves.toEqual({
      reservationId: 'res-1',
      apartmentId: 'room-1',
      hostId: 'host-1',
      guestId: 'guest-1',
      escrowId: 'esc-1',
    })

    expect(mockedHotelQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockedHotelQuery.mock.calls[0]
    expect(sql).toContain('hotel_industry.escrow_transactions')
    expect(sql).not.toMatch(/safetrust\./)
    expect(params).toEqual(['C123'])
  })

  it('returns null when the contract is not a hotel escrow', async () => {
    mockedHotelQuery.mockResolvedValueOnce({ rows: [] } as never)
    await expect(resolveHotelEscrowParties('unknown')).resolves.toBeNull()
  })

  it('returns null when a participant is missing', async () => {
    mockedHotelQuery.mockResolvedValueOnce({
      rows: [{ reservation_id: 'res-1', escrow_transaction_id: 'e', apartment_id: 'r', host_id: 'h', guest_id: null }],
    } as never)
    await expect(resolveHotelEscrowParties('C123')).resolves.toBeNull()
  })
})
