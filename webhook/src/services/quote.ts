import { PoolClient } from 'pg'
import db, { query } from './db'
import { NotFoundError, ValidationError } from '../utils/errors'

export interface QuoteInput {
  propertyId: string
  checkIn: string
  checkOut: string
  guests?: number
}

export interface QuoteResult {
  propertyId: string
  checkIn: string
  checkOut: string
  nights: number
  pricePerNight: string
  total: string
  deposit: string
  asset: string
  ownerId?: string
  propertyName?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate YYYY-MM-DD date format and parse.
 */
export function parseDateString(value: unknown, fieldName: string): Date {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid date in YYYY-MM-DD format`)
  }
  const [yStr, mStr, dStr] = value.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const day = Number(dStr)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError(`${fieldName} is an invalid calendar date`)
  }
  return date
}

/**
 * Calculate the number of nights between check-in and check-out.
 * Ensures check_out is strictly after check_in.
 */
export function calculateStayNights(checkIn: string | Date, checkOut: string | Date): number {
  const resolvedIn = typeof checkIn === 'string' ? parseDateString(checkIn, 'check_in') : checkIn
  const resolvedOut = typeof checkOut === 'string' ? parseDateString(checkOut, 'check_out') : checkOut
  const start = resolvedIn instanceof Date ? resolvedIn.getTime() : Date.parse(String(resolvedIn))
  const end = resolvedOut instanceof Date ? resolvedOut.getTime() : Date.parse(String(resolvedOut))

  if (Number.isNaN(start)) {
    throw new ValidationError('check_in is an invalid date')
  }
  if (Number.isNaN(end)) {
    throw new ValidationError('check_out is an invalid date')
  }
  if (end <= start) {
    throw new ValidationError('check_out must be after check_in')
  }

  const msPerDay = 86_400_000
  return Math.max(1, Math.round((end - start) / msPerDay))
}

/**
 * Pure calculation of total stay price and security deposit from apartment rates and dates.
 * Enforces server-side authority: client amounts are never trusted.
 */
export function calculateQuote(
  apartment: {
    price: number | string
    warranty_deposit: number | string
  },
  checkIn: string | Date,
  checkOut: string | Date
): {
  nights: number
  pricePerNight: string
  total: string
  deposit: string
  asset: string
} {
  const nights = calculateStayNights(checkIn, checkOut)
  const price = Number(apartment.price)
  if (Number.isNaN(price) || price <= 0) {
    throw new ValidationError('Apartment rate must be a positive number')
  }

  const deposit = Number(apartment.warranty_deposit)
  if (Number.isNaN(deposit) || deposit < 0) {
    throw new ValidationError('Apartment warranty deposit must be a non-negative number')
  }

  const total = (price * nights).toFixed(2)
  const depositFormatted = deposit.toFixed(2)

  return {
    nights,
    pricePerNight: price.toFixed(2),
    total,
    deposit: depositFormatted,
    asset: 'USDC',
  }
}

/**
 * Database-backed quote lookup for a specific property.
 * Fetches the canonical apartment record and calculates total and deposit on the server.
 */
export async function getQuoteForProperty(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  guests?: number,
  client?: PoolClient
): Promise<QuoteResult> {
  const checkInDate = parseDateString(checkIn, 'check_in')
  const checkOutDate = parseDateString(checkOut, 'check_out')

  if (guests !== undefined) {
    if (typeof guests !== 'number' || !Number.isInteger(guests) || guests < 1) {
      throw new ValidationError('guests must be a positive integer')
    }
  }

  const sql = `
    SELECT id, name, price, warranty_deposit, owner_id, is_available, bedrooms
    FROM safetrust.apartments
    WHERE id = $1 AND deleted_at IS NULL
  `
  const result = client
    ? await client.query(sql, [propertyId])
    : await query<{
        id: string
        name: string
        price: string | number
        warranty_deposit: string | number
        owner_id: string
        is_available: boolean
        bedrooms: number | null
      }>(sql, [propertyId])

  const apartment = result.rows[0]
  if (!apartment) {
    throw new NotFoundError(`Property ${propertyId} not found`)
  }

  const quote = calculateQuote(apartment, checkInDate, checkOutDate)

  return {
    propertyId: apartment.id,
    propertyName: apartment.name,
    ownerId: apartment.owner_id,
    checkIn,
    checkOut,
    nights: quote.nights,
    pricePerNight: quote.pricePerNight,
    total: quote.total,
    deposit: quote.deposit,
    asset: quote.asset,
  }
}
