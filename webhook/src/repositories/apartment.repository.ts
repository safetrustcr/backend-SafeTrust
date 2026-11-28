import type {
  Apartment,
  ApartmentListQuery,
  ReportCategory,
} from '../domain'
import type { QueryResultRow } from 'pg'
import { query } from '../services/db'
import { liveHoldOverlapSql } from './hold.repository'

export interface ApartmentListFilters {
  location?: ApartmentListQuery['location']
  minPrice?: number
  maxPrice?: number
  bedrooms?: number
  petFriendly?: boolean
  category?: ApartmentListQuery['category']
  stay?: { checkIn: string; checkOut: string }
  limit: number
  offset: number
  sort: 'price_asc' | 'price_desc' | 'created_at'
}

interface CountRow extends QueryResultRow {
  total: string
}

export interface ListingReportApartment extends QueryResultRow {
  id: string
  owner_id: string | null
}

export interface ListingReportRow extends QueryResultRow {
  id: string
  status: string
  apartment_id: string
}

const INSERT_APARTMENT = `
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

export async function listApartments(filters: ApartmentListFilters): Promise<{
  total: number
  rows: Apartment[]
}> {
  const where: string[] = ['a.deleted_at IS NULL']
  const params: unknown[] = []
  const add = (clause: (index: number) => string, value: unknown) => {
    params.push(value)
    where.push(clause(params.length))
  }

  if (filters.location) {
    add((index) => `(a.name ILIKE $${index} OR a.description ILIKE $${index})`, `%${filters.location}%`)
  }
  if (filters.minPrice !== undefined) add((index) => `a.price >= $${index}`, filters.minPrice)
  if (filters.maxPrice !== undefined) add((index) => `a.price <= $${index}`, filters.maxPrice)
  if (filters.bedrooms !== undefined) add((index) => `a.bedrooms = $${index}`, filters.bedrooms)
  if (filters.petFriendly !== undefined) add((index) => `a.pet_friendly = $${index}`, filters.petFriendly)
  if (filters.category) add((index) => `a.category = $${index}`, filters.category)

  if (filters.stay) {
    params.push(filters.stay.checkIn, filters.stay.checkOut)
    where.push(`NOT ${liveHoldOverlapSql('a', `$${params.length - 1}`, `$${params.length}`)}`)
  }

  const whereString = `WHERE ${where.join(' AND ')}`
  const count = await query<CountRow>(
    `SELECT COUNT(*) as total FROM safetrust.apartments a ${whereString}`,
    params
  )
  const orderBy = {
    price_asc: 'a.price ASC',
    price_desc: 'a.price DESC',
    created_at: 'a.created_at DESC',
  }[filters.sort]
  const resultParams = [...params, filters.limit, filters.offset]
  const result = await query<Apartment>(
    `SELECT
       a.id, a.name, a.description, a.price, a.warranty_deposit, a.address,
       a.is_available, a.available_from, a.available_until, a.bedrooms,
       a.pet_friendly, a.category, a.created_at, u.email as owner_email
     FROM safetrust.apartments a
     LEFT JOIN safetrust.users u ON a.owner_id = u.id
     ${whereString}
     ORDER BY ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    resultParams
  )
  return { total: parseInt(count.rows[0].total, 10), rows: result.rows }
}

export async function createApartmentRecord(input: {
  ownerId: string
  name: string
  description: string
  price: number
  address: string
  rooms: number
  petFriendly: boolean
}): Promise<Apartment> {
  const result = await query<Apartment>(INSERT_APARTMENT, [
    input.ownerId,
    input.name,
    input.description,
    input.price,
    input.price,
    input.address,
    input.rooms,
    input.petFriendly,
  ])
  return result.rows[0]
}

export async function findApartmentById(
  id: string
): Promise<(Apartment & { owner_email: string }) | null> {
  const result = await query<Apartment & { owner_email: string }>(
    `SELECT a.*, u.email as owner_email
     FROM safetrust.apartments a
     LEFT JOIN safetrust.users u ON a.owner_id = u.id
     WHERE a.id = $1`,
    [id]
  )
  return result.rows[0] ?? null
}

export async function findListingReportApartment(id: string): Promise<ListingReportApartment | null> {
  const result = await query<ListingReportApartment>(
    'SELECT id, owner_id FROM safetrust.apartments WHERE id = $1 AND deleted_at IS NULL',
    [id]
  )
  return result.rows[0] ?? null
}

export async function countListingReports(reporterId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM safetrust.listing_reports
     WHERE reporter_id = $1 AND created_at > NOW() - $2::interval`,
    [reporterId, '24 hours']
  )
  return parseInt(result.rows[0].count, 10)
}

export async function insertListingReport(input: {
  apartmentId: string
  reporterId: string
  category: ReportCategory
  details: string | null
  clientOpId: string
}): Promise<ListingReportRow | null> {
  const result = await query<ListingReportRow>(
    `INSERT INTO safetrust.listing_reports (apartment_id, reporter_id, category, details, client_op_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (reporter_id, client_op_id) DO NOTHING
     RETURNING id, status, apartment_id`,
    [input.apartmentId, input.reporterId, input.category, input.details, input.clientOpId]
  )
  return result.rows[0] ?? null
}

export async function findListingReportByOpId(
  reporterId: string,
  clientOpId: string
): Promise<ListingReportRow | null> {
  const result = await query<ListingReportRow>(
    'SELECT id, status, apartment_id FROM safetrust.listing_reports WHERE reporter_id = $1 AND client_op_id = $2',
    [reporterId, clientOpId]
  )
  return result.rows[0] ?? null
}
