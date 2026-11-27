import { Request, Response } from 'express'
import { logger } from '../../../middleware/logger'
import { propertySearchQuerySchema } from '../../../validation'
import { calculatePropertyQuote } from '../../../lib/property-quote'
import { searchProperties as findProperties } from '../../../repositories/property.repository'
import { AppError } from '../../../utils/errors'

export async function searchProperties(
  req: Request,
  res: Response
): Promise<Response> {
  const { check_in, check_out, guests, location, min_bedrooms, max_price, page, limit } =
    propertySearchQuerySchema.parse(req.query)

  try {
    const result = await findProperties({
      checkIn: check_in,
      checkOut: check_out,
      guests,
      location,
      minBedrooms: min_bedrooms,
      maxPrice: max_price,
      limit,
      offset: (page - 1) * limit,
    })

    return res.status(200).json({
      properties: result.rows.map((property) => {
        const quote = calculatePropertyQuote({
          nightlyPrice: property.nightly_price,
          warrantyDeposit: property.warranty_deposit,
          checkIn: check_in,
          checkOut: check_out,
        })
        return {
          id: property.id,
          name: property.name,
          description: property.description,
          address: property.address,
          bedrooms: property.bedrooms,
          max_guests: property.max_guests,
          available: property.available,
          nights: quote.nights,
          nightly_price: quote.nightlyPrice,
          total: quote.total,
          deposit: quote.deposit,
          asset: 'USDC',
        }
      }),
      page,
      limit,
      has_more: result.hasMore,
    })
  } catch (error) {
    logger.error('properties.search.failed', { error })
    throw new AppError('Failed to search properties', 500)
  }
}
