import { query } from '../../db/pool'
import { listApartments } from '../apartment.repository'

jest.mock('../../db/pool', () => ({ query: jest.fn() }))

describe('listApartments repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'apartment-1' }] })
  })

  it('builds parameterized filters and appends pagination after filter values', async () => {
    await expect(listApartments({
      location: 'Beach',
      minPrice: 500,
      maxPrice: 1500,
      bedrooms: 2,
      petFriendly: true,
      category: 'luxury',
      limit: 5,
      offset: 5,
      sort: 'price_asc',
    })).resolves.toEqual({ total: 1, rows: [{ id: 'apartment-1' }] })

    const [countSql, countParams] = (query as jest.Mock).mock.calls[0]
    const [listSql, listParams] = (query as jest.Mock).mock.calls[1]
    expect(countSql).toContain('a.category = $6')
    expect(countParams).toEqual(['%Beach%', 500, 1500, 2, true, 'luxury'])
    expect(listSql).toContain('ORDER BY a.price ASC')
    expect(listSql).toContain('LIMIT $7 OFFSET $8')
    expect(listParams).toEqual(['%Beach%', 500, 1500, 2, true, 'luxury', 5, 5])
  })
})
