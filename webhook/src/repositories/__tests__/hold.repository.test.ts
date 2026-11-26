import { query, withTransaction } from '../../services/db'
import { createHold } from '../hold.repository'

jest.mock('../../services/db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}))

describe('hold.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('stores the same exact-price quote used by property discovery', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'property-1',
          price: '30.00',
          warranty_deposit: '45.00',
          max_guests: 4,
          is_available: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ n: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'hold-1',
          expires_at: new Date('2099-12-15T12:00:00Z'),
          quote_deposit: '45.00',
          asset_code: 'USDC',
        }],
        rowCount: 1,
      })
    const client = { query: clientQuery }
    ;(withTransaction as jest.Mock).mockImplementation(
      async (callback: (transaction: typeof client) => Promise<unknown>) => callback(client)
    )

    const result = await createHold({
      tenantId: 'safetrust',
      userId: 'guest-1',
      apartmentId: 'property-1',
      checkIn: '2099-12-15',
      checkOut: '2099-12-20',
      guests: 4,
    })

    const insertParams = clientQuery.mock.calls[5][1]
    expect(insertParams[6]).toBe('150.00')
    expect(insertParams[7]).toBe('45.00')
    expect(result.price_total).toBe('150.00')
    expect(query).not.toHaveBeenCalled()
  })
})
