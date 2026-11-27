import { query } from '../../services/db'
import { findPropertyAvailability, searchProperties } from '../property.repository'

jest.mock('../../services/db', () => ({ query: jest.fn() }))

describe('property.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reuses search_apartments and computes reservation/hold availability before pagination', async () => {
    ;(query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'property-1', available: false }, { id: 'property-2', available: true }],
    })

    const result = await searchProperties({
      location: 'San Juan',
      minBedrooms: 2,
      maxPrice: '100.00',
      guests: 4,
      checkIn: '2099-12-15',
      checkOut: '2099-12-20',
      limit: 1,
      offset: 1,
    })

    expect(result).toEqual({
      rows: [{ id: 'property-1', available: false }],
      hasMore: true,
    })
    const [sql, params] = (query as jest.Mock).mock.calls[0]
    expect(sql).toContain('safetrust.search_apartments')
    expect(sql).toContain('a.bedrooms >= $5')
    expect(sql).toContain("r.status <> 'cancelled'")
    expect(sql).toContain("h.status IN ('pending_payment', 'active')")
    expect(params).toEqual([
      null,
      'San Juan',
      '100.00',
      4,
      2,
      '2099-12-15',
      '2099-12-20',
      3,
      2,
      1,
    ])
  })

  it('checks a single property against reservation overlaps, live holds and guest capacity', async () => {
    ;(query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'property-1', available: false }] })

    await findPropertyAvailability({
      id: 'property-1',
      checkIn: '2099-12-15',
      checkOut: '2099-12-20',
      guests: 4,
    })

    const [sql, params] = (query as jest.Mock).mock.calls[0]
    expect(sql).toContain("r.status <> 'cancelled'")
    expect(sql).toContain("h.status IN ('pending_payment', 'active')")
    expect(sql).toContain('a.max_guests >= $4')
    expect(params).toEqual(['property-1', '2099-12-15', '2099-12-20', 4])
  })
})
