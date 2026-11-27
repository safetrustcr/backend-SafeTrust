import { Request, Response } from 'express'
import type { Apartment, ApartmentListQuery, ApartmentListResponse } from '@safetrust/types'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { AuthError, NotFoundError, ValidationError } from '../../utils/errors'
import {
  ApartmentListFilters,
  createApartmentRecord,
  findApartmentById,
  listApartments as findApartments,
} from '../../repositories/apartment.repository'

/**
 * Format apartment entity so decimal columns (price, warranty_deposit) from pg driver are converted to numbers,
 * while preserving null or undefined values for warranty_deposit.
 */
function formatApartment<T extends object>(apt: T): T {
  const formatted = { ...apt } as Record<string, unknown>
  if ('price' in formatted && formatted.price !== null && formatted.price !== undefined) {
    formatted.price = Number(formatted.price)
  }
  if ('warranty_deposit' in formatted && formatted.warranty_deposit !== null && formatted.warranty_deposit !== undefined) {
    formatted.warranty_deposit = Number(formatted.warranty_deposit)
  }
  return formatted as T
}

type ApartmentResponse = { apartment: Apartment } | { error: string }

/**
 * GET /api/apartments
 * Paginated apartment listing with optional filters
 */
export const listApartments = async (
  req: Request<{}, ApartmentListResponse | { error: string }, {}, ApartmentListQuery>,
  res: Response<ApartmentListResponse | { error: string }>
): Promise<Response<ApartmentListResponse | { error: string }>> => {
  const {
    location,
    minPrice,
    maxPrice,
    bedrooms,
    petFriendly,
    category,
    checkIn,
    checkOut,
    page = '1',
    limit = '10',
    sort = 'created_at',
  } = req.query

  const MAX_LIMIT = 100
  let validatedPage = parseInt(String(page), 10)
  let validatedLimit = parseInt(String(limit), 10)

  if (isNaN(validatedPage) || validatedPage < 1) validatedPage = 1
  if (isNaN(validatedLimit) || validatedLimit < 1) validatedLimit = 10
  if (validatedLimit > MAX_LIMIT) validatedLimit = MAX_LIMIT

  const offset = (validatedPage - 1) * validatedLimit

  let min: number | undefined
  if (minPrice) {
    min = parseFloat(String(minPrice))
    if (isNaN(min)) throw new ValidationError('Invalid minPrice value. Expected a number.')
  }

  let max: number | undefined
  if (maxPrice) {
    max = parseFloat(String(maxPrice))
    if (isNaN(max)) throw new ValidationError('Invalid maxPrice value. Expected a number.')
  }

  let beds: number | undefined
  if (bedrooms) {
    beds = parseInt(String(bedrooms), 10)
    if (isNaN(beds)) throw new ValidationError('Invalid bedrooms value. Expected an integer.')
  }

  let normalizedPet: boolean | undefined
  if (petFriendly !== undefined) {
    const value = String(petFriendly).toLowerCase()
    if (['true', '1', 'yes'].includes(value)) normalizedPet = true
    else if (['false', '0', 'no'].includes(value)) normalizedPet = false
    else {
      throw new ValidationError('Invalid petFriendly value. Expected true, false, 1, 0, yes, or no.')
    }
  }

  // Dates held by someone else (pending_payment or active) are unavailable.
  let stay: { checkIn: string; checkOut: string } | undefined
  if (checkIn !== undefined || checkOut !== undefined) {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (
      typeof checkIn !== 'string' || typeof checkOut !== 'string' ||
      !dateRe.test(checkIn) || !dateRe.test(checkOut) || checkOut <= checkIn
    ) {
      throw new ValidationError('checkIn and checkOut must both be YYYY-MM-DD dates with checkOut after checkIn.')
    }
    const isRealDate = (v: string) => {
      const d = new Date(`${v}T00:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
    }
    if (!isRealDate(checkIn) || !isRealDate(checkOut)) {
      throw new ValidationError('checkIn and checkOut must be valid calendar dates.')
    }
    stay = { checkIn, checkOut }
  }

  const allowedSorts = ['price_asc', 'price_desc', 'created_at']
  if (sort && !allowedSorts.includes(sort)) {
    throw new ValidationError(`Invalid sort parameter. Supported values: ${allowedSorts.join(', ')}`)
  }

  const result = await findApartments({
    location,
    minPrice: min,
    maxPrice: max,
    bedrooms: beds,
    petFriendly: normalizedPet,
    category,
    stay,
    limit: validatedLimit,
    offset,
    sort: (sort || 'created_at') as ApartmentListFilters['sort'],
  })
  const totalPages = Math.ceil(result.total / validatedLimit)

  return res.status(200).json({
    apartments: result.rows.map(formatApartment),
    total: result.total,
    page: validatedPage,
    totalPages,
  })
}

/**
 * POST /api/apartments
 * Create apartment listing for authenticated owner
 */
export const createApartment = async (
  req: AuthenticatedRequest,
  res: Response<ApartmentResponse>
): Promise<Response<ApartmentResponse>> => {
  const ownerId = req.context?.uid || req.user?.uid
  const {
    name,
    location,
    pricePerMonth,
    promotionPercent = null,
    rooms = 1,
    bathrooms = 1,
    petFriendly = false,
    description = '',
  } = req.body || {}

  const normalizedName = typeof name === 'string' ? name.trim() : ''
  const normalizedLocation = typeof location === 'string' ? location.trim() : ''

  if (!ownerId) throw new AuthError('Unauthorized')

  if (!normalizedName || !normalizedLocation || pricePerMonth === undefined || pricePerMonth === null) {
    throw new ValidationError('Missing required fields: name, location, pricePerMonth')
  }

  const parsedPrice = Number(pricePerMonth)
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    throw new ValidationError('Invalid pricePerMonth')
  }

  const parsedRooms = Number(rooms)
  if (!Number.isInteger(parsedRooms) || parsedRooms < 1) {
    throw new ValidationError('Invalid rooms value')
  }

  if (promotionPercent !== null) {
    const promo = Number(promotionPercent)
    if (!Number.isFinite(promo) || promo < 0 || promo > 100) {
      throw new ValidationError('Invalid promotionPercent')
    }
  }

  const parsedBathrooms = Number(bathrooms)
  if (!Number.isFinite(parsedBathrooms) || parsedBathrooms < 1) {
    throw new ValidationError('Invalid bathrooms value')
  }

  const payloadAddress = {
    location: normalizedLocation,
    bathrooms: parsedBathrooms,
    promotionPercent,
  }

  const result = await createApartmentRecord({
    ownerId,
    name: normalizedName,
    description: String(description ?? ''),
    price: parsedPrice,
    address: JSON.stringify(payloadAddress),
    rooms: parsedRooms,
    petFriendly: Boolean(petFriendly),
  })

  return res.status(201).json({ apartment: formatApartment(result) })
}

/**
 * GET /api/apartments/:id
 * Get a single apartment by ID
 */
export const getApartmentById = async (
  req: Request<{ id: string }>,
  res: Response<ApartmentResponse>
): Promise<Response<ApartmentResponse>> => {
  const { id } = req.params
  const apartment = await findApartmentById(id)

  if (!apartment) {
    throw new NotFoundError('Apartment not found')
  }

  return res.status(200).json({ apartment: formatApartment(apartment) })
}

export default { listApartments, createApartment, getApartmentById }
