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
const requiredEnvVars = ['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']
for (const key of requiredEnvVars) {
  if (!process.env[key] && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

const connectionTimeoutMillis = positiveIntegerFromEnv('DB_CONNECTION_TIMEOUT_MS', 5_000)
const query_timeout = positiveIntegerFromEnv('DB_QUERY_TIMEOUT_MS', 30_000)

export const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'postgres',
  user:     process.env.POSTGRES_USER     ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgrespassword',
  connectionTimeoutMillis,
  query_timeout,
})

pool.on('error', (err: Error) => {
  console.error('[db] Unexpected error on idle database client:', err)
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
  const client = await connect()
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

export default { query, connect, pool, withTransaction }