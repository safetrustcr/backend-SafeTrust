import type { QueryResultRow } from 'pg'
import { query } from '../services/db'

export interface PropertyAvailabilityRow extends QueryResultRow {
  id: string
  name: string
  description: string | null
  address: Record<string, unknown> | string
  nightly_price: string
  warranty_deposit: string
  bedrooms: number | null
  max_guests: number | null
  available: boolean
}

export interface PropertySearchFilters {
  checkIn: string
  checkOut: string
  guests: number
  location?: string
  minBedrooms?: number
  maxPrice?: string
  limit: number
  offset: number
}

export async function searchProperties(filters: PropertySearchFilters): Promise<{
  rows: PropertyAvailabilityRow[]
  hasMore: boolean
}> {
  // Each exact-bedroom bucket must provide enough rows to assemble the global page.
  const candidateLimit = filters.offset + filters.limit + 1
  const result = await query<PropertyAvailabilityRow>(
    `WITH bedroom_filters AS (
       SELECT DISTINCT a.bedrooms AS bedroom_filter
       FROM safetrust.apartments a
       WHERE $5::integer IS NOT NULL AND a.bedrooms >= $5
       UNION ALL
       SELECT NULL::integer WHERE $5::integer IS NULL
     ),
     candidates AS (
       SELECT matches.*
       FROM bedroom_filters b
       CROSS JOIN LATERAL safetrust.search_apartments(
         $1::text,
         $2::text,
         NULL::numeric,
         $3::numeric,
         b.bedroom_filter,
         $4::integer,
         NULL::boolean,
         NULL::boolean,
         $8::integer,
         0
       ) matches
     )
     SELECT
       a.id,
       a.name,
       a.description,
       a.address,
       a.price::text AS nightly_price,
       a.warranty_deposit::text AS warranty_deposit,
       a.bedrooms,
       a.max_guests,
       (
         a.is_available IS TRUE
         AND a.available_from::date <= $6::date
         AND (a.available_until IS NULL OR a.available_until::date >= $7::date)
         AND
         NOT EXISTS (
           SELECT 1
           FROM safetrust.reservations r
           WHERE r.apartment_id = a.id
             AND r.status <> 'cancelled'
             AND r.check_in_date < ($7::date::timestamp AT TIME ZONE 'UTC')
             AND r.check_out_date > ($6::date::timestamp AT TIME ZONE 'UTC')
         )
         AND NOT EXISTS (
           SELECT 1
           FROM safetrust.booking_holds h
           WHERE h.apartment_id = a.id
             AND h.status IN ('pending_payment', 'active')
             AND h.expires_at > NOW()
             AND h.check_in < ($7::date::timestamp AT TIME ZONE 'UTC')
             AND h.check_out > ($6::date::timestamp AT TIME ZONE 'UTC')
         )
       ) AS available
     FROM candidates a
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $9 OFFSET $10`,
    [
      null,
      filters.location ?? null,
      filters.maxPrice ?? null,
      filters.guests,
      filters.minBedrooms ?? null,
      filters.checkIn,
      filters.checkOut,
      candidateLimit,
      filters.limit + 1,
      filters.offset,
    ]
  )

  return {
    rows: result.rows.slice(0, filters.limit),
    hasMore: result.rows.length > filters.limit,
  }
}

export async function findPropertyAvailability(input: {
  id: string
  checkIn: string
  checkOut: string
  guests: number
}): Promise<PropertyAvailabilityRow | null> {
  const result = await query<PropertyAvailabilityRow>(
    `SELECT
       a.id,
       a.name,
       a.description,
       a.address,
       a.price::text AS nightly_price,
       a.warranty_deposit::text AS warranty_deposit,
       a.bedrooms,
       a.max_guests,
       (
         a.is_available IS TRUE
         AND a.available_from::date <= $2::date
         AND (a.available_until IS NULL OR a.available_until::date >= $3::date)
         AND (a.max_guests IS NULL OR a.max_guests >= $4)
         AND NOT EXISTS (
           SELECT 1
           FROM safetrust.reservations r
           WHERE r.apartment_id = a.id
             AND r.status <> 'cancelled'
             AND r.check_in_date < ($3::date::timestamp AT TIME ZONE 'UTC')
             AND r.check_out_date > ($2::date::timestamp AT TIME ZONE 'UTC')
         )
         AND NOT EXISTS (
           SELECT 1
           FROM safetrust.booking_holds h
           WHERE h.apartment_id = a.id
             AND h.status IN ('pending_payment', 'active')
             AND h.expires_at > NOW()
             AND h.check_in < ($3::date::timestamp AT TIME ZONE 'UTC')
             AND h.check_out > ($2::date::timestamp AT TIME ZONE 'UTC')
         )
       ) AS available
     FROM safetrust.apartments a
     WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [input.id, input.checkIn, input.checkOut, input.guests]
  )

  return result.rows[0] ?? null
}
