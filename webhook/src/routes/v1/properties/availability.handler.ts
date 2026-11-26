import { Request, Response } from 'express'
import { logger } from '../../../middleware/logger'
import { propertyAvailabilityQuerySchema } from '../../../validation'
import { calculatePropertyQuote } from '../../../lib/property-quote'
import { findPropertyAvailability } from '../../../repositories/property.repository'

export async function getPropertyAvailability(
  req: Request<{ id: string }>,
  res: Response
): Promise<Response> {
  const { check_in, check_out, guests } = propertyAvailabilityQuerySchema.parse(req.query)

  try {
    const property = await findPropertyAvailability({
      id: req.params.id,
      checkIn: check_in,
      checkOut: check_out,
      guests,
    })
    if (!property) return res.status(404).json({ error: 'Property not found' })

    const quote = calculatePropertyQuote({
      nightlyPrice: property.nightly_price,
      warrantyDeposit: property.warranty_deposit,
      checkIn: check_in,
      checkOut: check_out,
    })

    return res.status(200).json({
      property_id: property.id,
      available: property.available,
      nights: quote.nights,
      nightly_price: quote.nightlyPrice,
      total: quote.total,
      deposit: quote.deposit,
      asset: 'USDC',
    })
  } catch (error) {
    logger.error('properties.availability.failed', { error })
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}
