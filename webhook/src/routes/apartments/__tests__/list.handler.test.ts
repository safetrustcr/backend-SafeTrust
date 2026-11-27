import { Request, Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import {
  createApartmentRecord,
  findApartmentById,
  listApartments as findApartments,
} from '../../../repositories/apartment.repository'
import { listApartments, createApartment, getApartmentById } from '../list.handler'
import { runHandler } from '../../__tests__/run-handler'

jest.mock('../../../repositories/apartment.repository', () => ({
  createApartmentRecord: jest.fn(),
  findApartmentById: jest.fn(),
  listApartments: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('apartments/list.handler', () => {
  beforeEach(() => jest.clearAllMocks())

  it('lists apartments with normalized pagination and decimal values', async () => {
    ;(findApartments as jest.Mock).mockResolvedValue({
      total: 1,
      rows: [{ id: 'apt-1', name: 'Cozy Apartment', price: '1000.50', warranty_deposit: '500.00' }],
    })
    const res = makeResponse()
    await listApartments({ query: {} } as Request, res)

    expect(findApartments).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10, offset: 0, sort: 'created_at',
    }))
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      apartments: [{ id: 'apt-1', name: 'Cozy Apartment', price: 1000.5, warranty_deposit: 500 }],
      total: 1, page: 1, totalPages: 1,
    })
  })

  it('normalizes filters before passing them to the repository', async () => {
    ;(findApartments as jest.Mock).mockResolvedValue({ total: 0, rows: [] })
    const res = makeResponse()
    await listApartments({
      query: {
        location: 'Beach', minPrice: '500', maxPrice: '1500', bedrooms: '2',
        petFriendly: 'true', category: 'luxury', sort: 'price_asc', page: '2', limit: '5',
      },
    } as unknown as Request, res)
    expect(findApartments).toHaveBeenCalledWith({
      location: 'Beach', minPrice: 500, maxPrice: 1500, bedrooms: 2,
      petFriendly: true, category: 'luxury', limit: 5, offset: 5, sort: 'price_asc',
    })
  })

  it.each([
    [{ minPrice: 'abc' }, 'Invalid minPrice value. Expected a number.'],
    [{ maxPrice: 'abc' }, 'Invalid maxPrice value. Expected a number.'],
    [{ bedrooms: 'abc' }, 'Invalid bedrooms value. Expected an integer.'],
    [{ petFriendly: 'maybe' }, 'Invalid petFriendly value. Expected true, false, 1, 0, yes, or no.'],
    [{ sort: 'invalid_sort' }, 'Invalid sort parameter. Supported values: price_asc, price_desc, created_at'],
  ])('returns 400 for an invalid list query', async (query, error) => {
    const res = makeResponse()
    await runHandler(listApartments, { query } as unknown as Request, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error }))
    expect(findApartments).not.toHaveBeenCalled()
  })

  it('returns 500 when the list repository fails', async () => {
    ;(findApartments as jest.Mock).mockRejectedValue(new Error('DB failure'))
    const res = makeResponse()
    await runHandler(listApartments, { query: {} } as Request, res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Internal server error' }))
  })

  it('validates and creates an apartment, preserving formatted response values', async () => {
    ;(createApartmentRecord as jest.Mock).mockResolvedValue({
      id: 'apt-100', name: 'New Spot', price: '1200.00', warranty_deposit: '1200.00',
    })
    const req = {
      user: { uid: 'owner-1' },
      body: { name: 'New Spot', location: 'Downtown', pricePerMonth: 1200, rooms: 2, bathrooms: 1 },
    } as AuthenticatedRequest
    const res = makeResponse()
    await runHandler(createApartment, req, res)
    expect(createApartmentRecord).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1', name: 'New Spot', price: 1200, rooms: 2,
    }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      apartment: { id: 'apt-100', name: 'New Spot', price: 1200, warranty_deposit: 1200 },
    })
  })

  it('returns unchanged create errors for invalid input and repository failures', async () => {
    const unauthorized = makeResponse()
    await runHandler(createApartment, {} as AuthenticatedRequest, unauthorized)
    expect(unauthorized.status).toHaveBeenCalledWith(401)

    ;(createApartmentRecord as jest.Mock).mockRejectedValue(new Error('Insert error'))
    const failed = makeResponse()
    await runHandler(createApartment, {
      user: { uid: 'owner-1' },
      body: { name: 'Place', location: 'Downtown', pricePerMonth: 1200 },
    } as AuthenticatedRequest, failed)
    expect(failed.status).toHaveBeenCalledWith(500)
    expect(failed.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Internal server error' }))
  })

  it('returns, formats, and reports missing single apartments', async () => {
    ;(findApartmentById as jest.Mock).mockResolvedValueOnce({
      id: 'apt-1', name: 'Luxury Condo', price: '2500.00', warranty_deposit: null, owner_email: 'owner@example.com',
    }).mockResolvedValueOnce(null)
    const found = makeResponse()
    await getApartmentById({ params: { id: 'apt-1' } } as Request<{ id: string }>, found)
    expect(found.status).toHaveBeenCalledWith(200)
    expect(found.json).toHaveBeenCalledWith({
      apartment: { id: 'apt-1', name: 'Luxury Condo', price: 2500, warranty_deposit: null, owner_email: 'owner@example.com' },
    })

    const missing = makeResponse()
    await runHandler(getApartmentById, { params: { id: 'missing' } } as Request<{ id: string }>, missing)
    expect(missing.status).toHaveBeenCalledWith(404)
    expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Apartment not found' }))
  })
})
