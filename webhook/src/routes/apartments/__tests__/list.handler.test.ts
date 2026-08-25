import { Request, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { listApartments, createApartment, getApartmentById } from '../list.handler'
import { query } from '../../../services/db'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
  default: {
    query: jest.fn(),
  },
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('apartments/list.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('listApartments', () => {
    it('returns list of apartments with default pagination and converts decimal strings to numbers', async () => {
      const mockCount = { rows: [{ total: '1' }] }
      const mockApartmentFromDb = {
        id: 'apt-1',
        name: 'Cozy Apartment',
        price: '1000.50',
        warranty_deposit: '500.00',
        bedrooms: 2,
      }
      const mockData = { rows: [mockApartmentFromDb] }

      ;(query as jest.Mock)
        .mockResolvedValueOnce(mockCount)
        .mockResolvedValueOnce(mockData)

      const req = { query: {} } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        apartments: [
          {
            id: 'apt-1',
            name: 'Cozy Apartment',
            price: 1000.5,
            warranty_deposit: 500,
            bedrooms: 2,
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      })
    })

    it('preserves null warranty_deposit', async () => {
      const mockCount = { rows: [{ total: '1' }] }
      const mockApartmentFromDb = {
        id: 'apt-1',
        name: 'Cozy Apartment',
        price: '1000.00',
        warranty_deposit: null,
      }

      ;(query as jest.Mock)
        .mockResolvedValueOnce(mockCount)
        .mockResolvedValueOnce({ rows: [mockApartmentFromDb] })

      const req = { query: {} } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        apartments: [
          {
            id: 'apt-1',
            name: 'Cozy Apartment',
            price: 1000,
            warranty_deposit: null,
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      })
    })

    it('filters by minPrice, maxPrice, bedrooms, petFriendly, category, and location', async () => {
      const mockCount = { rows: [{ total: '0' }] }
      const mockData = { rows: [] }

      ;(query as jest.Mock)
        .mockResolvedValueOnce(mockCount)
        .mockResolvedValueOnce(mockData)

      const req = {
        query: {
          location: 'Beach',
          minPrice: '500',
          maxPrice: '1500',
          bedrooms: '2',
          petFriendly: 'true',
          category: 'luxury',
          sort: 'price_asc',
          page: '2',
          limit: '5',
        },
      } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('returns 400 for invalid minPrice', async () => {
      const req = { query: { minPrice: 'abc' } } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid minPrice value. Expected a number.' })
    })

    it('returns 400 for invalid maxPrice', async () => {
      const req = { query: { maxPrice: 'abc' } } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid maxPrice value. Expected a number.' })
    })

    it('returns 400 for invalid bedrooms', async () => {
      const req = { query: { bedrooms: 'abc' } } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid bedrooms value. Expected an integer.' })
    })

    it('returns 400 for invalid petFriendly value', async () => {
      const req = { query: { petFriendly: 'maybe' } } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid petFriendly value. Expected true, false, 1, 0, yes, or no.',
      })
    })

    it('returns 400 for invalid sort parameter', async () => {
      const req = { query: { sort: 'invalid_sort' } } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid sort parameter. Supported values: price_asc, price_desc, created_at',
      })
    })

    it('returns 500 when database query throws an error', async () => {
      ;(query as jest.Mock).mockRejectedValueOnce(new Error('DB failure'))

      const req = { query: {} } as Request<any, any, any, any>
      const res = makeResponse()

      await listApartments(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
    })
  })

  describe('createApartment', () => {
    it('returns 401 when unauthorized (no user on request)', async () => {
      const req = {} as AuthenticatedRequest
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })

    it('returns 400 when missing required fields', async () => {
      const req = {
        user: { uid: 'owner-1' },
        body: { name: 'Apartment' },
      } as AuthenticatedRequest
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Missing required fields: name, location, pricePerMonth',
      })
    })

    it('creates apartment on valid input and formats decimal numbers', async () => {
      const createdDbRow = { id: 'apt-100', name: 'New Spot', price: '1200.00', warranty_deposit: '1200.00' }
      ;(query as jest.Mock).mockResolvedValueOnce({ rows: [createdDbRow] })

      const req = {
        user: { uid: 'owner-1' },
        body: {
          name: 'New Spot',
          location: 'Downtown',
          pricePerMonth: 1200,
          rooms: 2,
          bathrooms: 1,
          petFriendly: true,
          description: 'Nice place',
        },
      } as AuthenticatedRequest
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        apartment: { id: 'apt-100', name: 'New Spot', price: 1200, warranty_deposit: 1200 },
      })
    })

    it('returns 500 when insert query fails', async () => {
      ;(query as jest.Mock).mockRejectedValueOnce(new Error('Insert error'))

      const req = {
        user: { uid: 'owner-1' },
        body: {
          name: 'New Spot',
          location: 'Downtown',
          pricePerMonth: 1200,
        },
      } as AuthenticatedRequest
      const res = makeResponse()

      await createApartment(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create apartment' })
    })
  })

  describe('getApartmentById', () => {
    it('returns apartment when found and converts decimal values', async () => {
      const apt = { id: 'apt-1', name: 'Luxury Condo', price: '2500.00', warranty_deposit: null, owner_email: 'owner@example.com' }
      ;(query as jest.Mock).mockResolvedValueOnce({ rows: [apt] })

      const req = { params: { id: 'apt-1' } } as unknown as Request<{ id: string }>
      const res = makeResponse()

      await getApartmentById(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        apartment: { id: 'apt-1', name: 'Luxury Condo', price: 2500, warranty_deposit: null, owner_email: 'owner@example.com' },
      })
    })

    it('returns 404 when apartment not found', async () => {
      ;(query as jest.Mock).mockResolvedValueOnce({ rows: [] })

      const req = { params: { id: 'non-existent' } } as unknown as Request<{ id: string }>
      const res = makeResponse()

      await getApartmentById(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'Apartment not found' })
    })

    it('returns 500 on database failure', async () => {
      ;(query as jest.Mock).mockRejectedValueOnce(new Error('Select failed'))

      const req = { params: { id: 'apt-1' } } as unknown as Request<{ id: string }>
      const res = makeResponse()

      await getApartmentById(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
    })
  })
})
