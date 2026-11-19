'use strict'

import { Pool, QueryResult, PoolClient, QueryResultRow } from 'pg'

function positiveIntegerFromEnv(name: string, defaultValue: number): number {
  const value = process.env[name]
  if (value === undefined) {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

// Fail fast — never use hardcoded credentials in production
const requiredEnvVars = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD']
for (const key of requiredEnvVars) {
  if (!process.env[key] && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

const connectionTimeoutMillis = positiveIntegerFromEnv('DB_CONNECTION_TIMEOUT_MS', 5_000)
const query_timeout = positiveIntegerFromEnv('DB_QUERY_TIMEOUT_MS', 30_000)

// One database per tenant. POSTGRES_DB is accepted as a legacy fallback for the
// safetrust database so existing deployments keep working until they migrate.
export const SAFETRUST_DB = process.env.POSTGRES_SAFETRUST_DB ?? process.env.POSTGRES_DB ?? 'safetrust'
export const HOTEL_INDUSTRY_DB = process.env.POSTGRES_HOTEL_INDUSTRY_DB ?? 'hotel_industry'

function createTenantPool(database: string): Pool {
  return new Pool({
    host:     process.env.POSTGRES_HOST     ?? 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database,
    user:     process.env.POSTGRES_USER     ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? 'postgrespassword',
    connectionTimeoutMillis,
    query_timeout,
  })
}

/** Pool for the `safetrust` tenant database. */
export const pool = createTenantPool(SAFETRUST_DB)

/** Pool for the `hotel_industry` tenant database. */
export const hotelPool = createTenantPool(HOTEL_INDUSTRY_DB)

pool.on('error', (err: Error) => {
  console.error('[db] Unexpected error on idle safetrust database client:', err)
})

hotelPool.on('error', (err: Error) => {
  console.error('[db] Unexpected error on idle hotel_industry database client:', err)
})

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params)
}

export async function connect(): Promise<PoolClient> {
  return pool.connect()
}

/**
 * Executes a callback within an atomic PostgreSQL transaction.
 * Automatically issues BEGIN, COMMIT on success, or ROLLBACK on error,
 * and guarantees the client is released back to the pool.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runInTransaction(pool, fn)
}

/** Same as withTransaction, on the hotel_industry database. */
export async function withHotelTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runInTransaction(hotelPool, fn)
}

export async function hotelQuery<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return hotelPool.query<T>(text, params)
}

async function runInTransaction<T>(
  targetPool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await targetPool.connect()
  let releaseError: Error | undefined
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db] Failed to rollback transaction:', rollbackError)
      // Rollback failed: the connection may still be in an aborted transaction.
      // Pass the error to release() so pg discards it instead of pooling it.
      releaseError = rollbackError as Error
    }
    throw error
  } finally {
    client.release(releaseError)
  }
}

export default { query, connect, pool, withTransaction, hotelPool, hotelQuery, withHotelTransaction }