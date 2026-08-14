'use strict'

import { Pool, QueryResult, PoolClient, QueryResultRow } from 'pg'

// Fail fast — never use hardcoded credentials in production
const requiredEnvVars = ['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']
for (const key of requiredEnvVars) {
  if (!process.env[key] && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

export const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'postgres',
  user:     process.env.POSTGRES_USER     ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgrespassword',
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

export default { query, connect, pool }