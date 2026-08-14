'use strict'

import { Pool, QueryResult, PoolClient, QueryResultRow } from 'pg'

/** Shared PostgreSQL pool for the webhook service. */
export const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'postgres',
  user:     process.env.POSTGRES_USER     ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgrespassword',
})

// Handle pool errors to prevent process crash
pool.on('error', (err: Error) => {
  console.error('[db] Unexpected error on idle database client:', err)
})

/**
 * Execute a SQL query against the database pool.
 */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params)
}

/**
 * Acquire a pool client for transaction management.
 */
export async function connect(): Promise<PoolClient> {
  return pool.connect()
}

export default { query, connect, pool }