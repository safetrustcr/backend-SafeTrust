import { Request, Response } from 'express'
import type { Apartment, ApartmentListResponse } from '@safetrust/types'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import db, { query } from '../../services/db'
import { logger } from '../../middleware/logger'
import type { ApartmentListQuery, CreateApartmentBody } from '../../validation'

/**
 * Format apartment entity so decimal columns (price, warranty_deposit) from pg driver are converted to numbers,
 * while preserving null or undefined values for warranty_deposit.
 */
function formatApartment<T extends Record<string, any>>(apt: T): T {
  if (!apt) return apt
  const formatted: Record<string, any> = { ...apt }
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
  try {
    const {
      location,
      minPrice,
      maxPrice,
      bedrooms,
      petFriendly,
      category,
      page = '1',
      limit = '10',
      sort = 'created_at',
    } = req.query

    const validatedPage = Number(page)
    const validatedLimit = Number(limit)

    const offset = (validatedPage - 1) * validatedLimit

    const whereClause: string[] = ['a.deleted_at IS NULL']
    const queryParams: unknown[] = []
    let paramIndex = 1

    if (location) {
      whereClause.push(`(a.name ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex})`)
      queryParams.push(`%${location}%`)
      paramIndex++
    }

    if (minPrice !== undefined) {
      const min = Number(minPrice)
      whereClause.push(`a.price >= $${paramIndex}`)
      queryParams.push(min)
      paramIndex++
    }

    if (maxPrice !== undefined) {
      const max = Number(maxPrice)
      whereClause.push(`a.price <= $${paramIndex}`)
      queryParams.push(max)
      paramIndex++
    }

    if (bedrooms !== undefined) {
      const beds = Number(bedrooms)
      whereClause.push(`a.bedrooms = $${paramIndex}`)
      queryParams.push(beds)
      paramIndex++
    }

    if (petFriendly !== undefined) {
      const normalizedPet = petFriendly.toLowerCase()

      if (['true', '1', 'yes'].includes(normalizedPet)) {
        whereClause.push(`a.pet_friendly = $${paramIndex}`)
        queryParams.push(true)
        paramIndex++
      } else if (['false', '0', 'no'].includes(normalizedPet)) {
        whereClause.push(`a.pet_friendly = $${paramIndex}`)
        queryParams.push(false)
        paramIndex++
      }
    }

    if (category) {
      whereClause.push(`a.category = $${paramIndex}`)
      queryParams.push(category)
      paramIndex++
    }

    const whereString = `WHERE ${whereClause.join(' AND ')}`

    const sortMapping: Record<string, string> = {
      price_asc: 'a.price ASC',
      price_desc: 'a.price DESC',
      created_at: 'a.created_at DESC',
    }
    const orderClause = sortMapping[sort] || sortMapping['created_at']

    const countQuery = `
      SELECT COUNT(*) as total
      FROM safetrust.apartments a
      ${whereString}
    `
    const countResult = await query<{ total: string }>(countQuery, queryParams)
    const totalCount = parseInt(countResult.rows[0].total, 10)

    const dataQuery = `
      SELECT
        a.id,
        a.name,
        a.description,
        a.price,
        a.warranty_deposit,
        a.address,
        a.is_available,
        a.available_from,
        a.available_until,
        a.bedrooms,
        a.pet_friendly,
        a.category,
        a.created_at,
        u.email as owner_email
      FROM safetrust.apartments a
      LEFT JOIN safetrust.users u ON a.owner_id = u.id
      ${whereString}
      ORDER BY ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const finalParams = [...queryParams, validatedLimit, offset]
    const dataResult = await query<Apartment>(dataQuery, finalParams)
    const totalPages = Math.ceil(totalCount / validatedLimit)

    return res.status(200).json({
      apartments: dataResult.rows.map(formatApartment),
      total: totalCount,
      page: validatedPage,
      totalPages,
    })
  } catch (error) {
    const err = error as Error
    logger.error('apartments.list.failed', { error: err })
    return res.status(500).json({ error: 'Database error' })
  }
}

/**
 * POST /api/apartments
 * Create apartment listing for authenticated owner
 */
export const createApartment = async (
  req: AuthenticatedRequest & { body: CreateApartmentBody },
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

  if (!ownerId) return res.status(401).json({ error: 'Unauthorized' })

  const parsedPrice = Number(pricePerMonth)

  const parsedRooms = Number(rooms)
  const parsedBathrooms = Number(bathrooms)

  const insertSql = `
    INSERT INTO safetrust.apartments (
      owner_id,
      name,
      description,
      price,
      warranty_deposit,
      coordinates,
      address,
      available_from,
      bedrooms,
      pet_friendly
    )
    VALUES ($1, $2, $3, $4, $5, point(0, 0), $6::jsonb, NOW(), $7, $8)
    RETURNING *
  `

  const payloadAddress = {
    location: normalizedLocation,
    bathrooms: parsedBathrooms,
    promotionPercent,
  }

  try {
    const result = await query<Apartment>(insertSql, [
      ownerId,
      normalizedName,
      String(description ?? ''),
      parsedPrice,
      parsedPrice,
      JSON.stringify(payloadAddress),
      parsedRooms,
      Boolean(petFriendly),
    ])

    return res.status(201).json({ apartment: formatApartment(result.rows[0]) })
  } catch (error) {
    const err = error as Error
    logger.error('apartments.create.failed', { error: err })
    return res.status(500).json({ error: 'Failed to create apartment' })
  }
}

/**
 * GET /api/apartments/:id
 * Get a single apartment by ID
 */
export const getApartmentById = async (
  req: Request<{ id: string }>,
  res: Response<ApartmentResponse>
): Promise<Response<ApartmentResponse>> => {
  try {
    const { id } = req.params
    const querySql = `
      SELECT a.*, u.email as owner_email
      FROM safetrust.apartments a
      LEFT JOIN safetrust.users u ON a.owner_id = u.id
      WHERE a.id = $1
    `
    const result = await query<Apartment & { owner_email: string }>(querySql, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Apartment not found' })
    }

    return res.status(200).json({ apartment: formatApartment(result.rows[0]) })
  } catch (error) {
    const err = error as Error
    logger.error('apartments.get.failed', { error: err })
    return res.status(500).json({ error: 'Database error' })
  }
}

export default { listApartments, createApartment, getApartmentById }
