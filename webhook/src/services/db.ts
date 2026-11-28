'use strict'

import { readFileSync } from 'fs'
import { Pool, QueryResult, PoolClient, QueryResultRow, PoolConfig } from 'pg'

function positiveIntegerFromEnv(
  name: string,
  defaultValue: number,
  env: NodeJS.ProcessEnv
): number {
  const value = env[name]
  if (value === undefined) {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

export type DbSslMode = 'disable' | 'require' | 'verify-full'

const SSL_MODES: readonly DbSslMode[] = ['disable', 'require', 'verify-full']

function parseSslMode(value: string | undefined, nodeEnv: string): DbSslMode {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === '') {
    // Secure by default: production requires TLS unless explicitly disabled,
    // while the local Compose network has no TLS endpoint.
    return nodeEnv === 'production' ? 'require' : 'disable'
  }
  if (!(SSL_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `POSTGRES_SSL_MODE must be one of ${SSL_MODES.join(', ')} (got "${value}")`
    )
  }
  return raw as DbSslMode
}

function parseHostAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Resolves the pg pool configuration from the environment.
 *
 * - `POSTGRES_PASSWORD` is required in every environment: there is no fallback
 *   password, so a deployment that forgets it fails fast instead of silently
 *   connecting with a well-known credential.
 * - `POSTGRES_SSL_MODE` selects the TLS behaviour (`disable` | `require` |
 *   `verify-full`). It defaults to `require` in production and `disable`
 *   elsewhere.
 * - In production, `disable` is refused unless the target host is listed in
 *   `POSTGRES_SSL_ALLOW_DISABLE_HOSTS` (comma-separated).
 */
export function resolveDbConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const nodeEnv = env.NODE_ENV ?? 'development'

  const password = env.POSTGRES_PASSWORD
  if (!password) {
    throw new Error(
      'POSTGRES_PASSWORD is required (no default password is provided). ' +
        'Set it in the environment or .env file.'
    )
  }

  const host = env.POSTGRES_HOST ?? 'localhost'
  const sslMode = parseSslMode(env.POSTGRES_SSL_MODE, nodeEnv)

  if (sslMode === 'disable' && nodeEnv === 'production') {
    const allowed = parseHostAllowlist(env.POSTGRES_SSL_ALLOW_DISABLE_HOSTS)
    if (!allowed.includes(host.toLowerCase())) {
      throw new Error(
        'POSTGRES_SSL_MODE=disable is refused in production unless the database ' +
          `host is listed in POSTGRES_SSL_ALLOW_DISABLE_HOSTS (host: ${host})`
      )
    }
  }

  let ssl: PoolConfig['ssl'] = false
  if (sslMode === 'require') {
    // Encrypt in transit but do not verify the server certificate.
    ssl = { rejectUnauthorized: false }
  } else if (sslMode === 'verify-full') {
    const caFile = env.POSTGRES_SSL_CA_FILE
    if (!caFile) {
      throw new Error(
        'POSTGRES_SSL_MODE=verify-full requires POSTGRES_SSL_CA_FILE to point at a CA certificate'
      )
    }
    ssl = { rejectUnauthorized: true, ca: readFileSync(caFile, 'utf8') }
  }

  return {
    host,
    port: parseInt(env.POSTGRES_PORT ?? '5432', 10),
    database: env.POSTGRES_DB ?? 'postgres',
    user: env.POSTGRES_USER ?? 'postgres',
    password,
    ssl,
    connectionTimeoutMillis: positiveIntegerFromEnv('DB_CONNECTION_TIMEOUT_MS', 5_000, env),
    query_timeout: positiveIntegerFromEnv('DB_QUERY_TIMEOUT_MS', 30_000, env),
  }
}

export const pool = new Pool(resolveDbConfig())

pool.on('error', (err: Error) => {
  console.error('[db] Unexpected error on idle database client:', err)
})

export interface Queryable {
  query<T extends QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>
}

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
