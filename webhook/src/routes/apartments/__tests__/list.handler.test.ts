import { listApartments, createApartment, getApartmentById } from '../list.handler'
import db from '../../../services/db'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  pool: {},
}))

function makeResponse() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe('apartments handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('listApartments', () => {
    it('returns paginated apartments with default filters', async () => {
      ;(db.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ total: '2' }] })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', name: 'Apartment 1', price: 100 },
            { id: '2', name: 'Apartment 2', price: 200 },
          ],
        })

      const req: any = { query: {} }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        apartments: [
          { id: '1', name: 'Apartment 1', price: 100 },
          { id: '2', name: 'Apartment 2', price: 200 },
        ],
        total: 2,
        page: 1,
        totalPages: 1,
      })
    })

    it('returns 400 for invalid minPrice', async () => {
      const req: any = { query: { minPrice: 'invalid' } }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid minPrice value. Expected a number.',
      })
    })

    it('returns 400 for invalid maxPrice', async () => {
      const req: any = { query: { maxPrice: 'invalid' } }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid maxPrice value. Expected a number.',
      })
    })

    it('returns 400 for invalid bedrooms', async () => {
      const req: any = { query: { bedrooms: 'abc' } }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid bedrooms value. Expected an integer.',
      })
    })

    it('returns 400 for invalid petFriendly parameter', async () => {
      const req: any = { query: { petFriendly: 'maybe' } }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid petFriendly value. Expected true, false, 1, 0, yes, or no.',
      })
    })

    it('returns 400 for unsupported sort parameter', async () => {
      const req: any = { query: { sort: 'invalid_sort' } }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Invalid sort parameter'),
        })
      )
    })

    it('handles database errors gracefully', async () => {
      ;(db.query as jest.Mock).mockRejectedValueOnce(new Error('DB failure'))

      const req: any = { query: {} }
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
    })
  })

  describe('createApartment', () => {
    it('returns 401 when req.user is missing', async () => {
      const req: any = { body: {} }
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })

    it('returns 400 when required fields are missing', async () => {
      const req: any = { user: { uid: 'owner-1' }, body: { name: 'Loft' } }
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Missing required fields: name, location, pricePerMonth',
      })
    })

    it('creates apartment listing successfully', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'apt-1', name: 'Luxury Loft', price: 1500 }],
      })

      const req: any = {
        user: { uid: 'owner-1' },
        body: {
          name: 'Luxury Loft',
          location: 'Downtown',
          pricePerMonth: 1500,
        },
      }
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        apartment: { id: 'apt-1', name: 'Luxury Loft', price: 1500 },
      })
    })
  })

  describe('getApartmentById', () => {
    it('returns 404 if apartment is not found', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({ rows: [] })

      const req: any = { params: { id: 'non-existent' } }
      const res = makeResponse()

      await getApartmentById(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'Apartment not found' })
    })

    it('returns 200 with apartment details when found', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'apt-1', name: 'Cozy Flat' }],
      })

      const req: any = { params: { id: 'apt-1' } }
      const res = makeResponse()

      await getApartmentById(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        apartment: { id: 'apt-1', name: 'Cozy Flat' },
      })
    })
  })
})
