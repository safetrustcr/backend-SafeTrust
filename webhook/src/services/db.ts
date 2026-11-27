'use strict'

import { Pool, QueryResult, PoolClient, QueryResultRow } from 'pg'
import { readSecret } from '../config/secrets'

// Fail fast — never use hardcoded credentials in production
const requiredEnvVars = ['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_USER']
for (const key of requiredEnvVars) {
  if (!process.env[key] && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

// The password may come from POSTGRES_PASSWORD_FILE (/run/secrets/…) in production.
const postgresPassword = readSecret('POSTGRES_PASSWORD')
if (!postgresPassword && process.env.NODE_ENV === 'production') {
  throw new Error(
    'Missing required environment variable: POSTGRES_PASSWORD (or POSTGRES_PASSWORD_FILE)'
  )
}

export const pool = new Pool({
  host:     process.env.POSTGRES_HOST ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB   ?? 'postgres',
  user:     process.env.POSTGRES_USER ?? 'postgres',
  password: postgresPassword           ?? 'postgrespassword',
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