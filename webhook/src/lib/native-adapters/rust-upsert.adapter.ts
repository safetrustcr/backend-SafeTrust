import type { BulkUpsertAddon } from '../reconciliation.types'

const BULK_UPSERT_MODULE = '../../../../crates/pg-bulk-upsert'

let bulkUpsert: BulkUpsertAddon | null = null
let bulkUpsertLoadFailed = false
let bulkUpsertOverride: BulkUpsertAddon | null | undefined

function loadBulkUpsert(): BulkUpsertAddon | null {
  if (bulkUpsertOverride !== undefined) return bulkUpsertOverride
  if (bulkUpsert || bulkUpsertLoadFailed) return bulkUpsert
  try {
    bulkUpsert = require(BULK_UPSERT_MODULE)
  } catch (err) {
    bulkUpsertLoadFailed = true
    console.error(
      '[reconciliation] ⚠️  pg-bulk-upsert addon unavailable — ' +
        `falling back to row-by-row upsert: ${(err as Error).message}`
    )
  }
  return bulkUpsert
}

export function isRustBulkUpsertEnabled(): boolean {
  return process.env.RUST_BULK_UPSERT_ENABLED === 'true'
}

export function buildConnectionString(): string {
  const user = process.env.POSTGRES_USER
  const password = process.env.POSTGRES_PASSWORD
  if (!user || !password) {
    throw new Error(
      'pg-bulk-upsert requires POSTGRES_USER and POSTGRES_PASSWORD to be set'
    )
  }
  const enc = encodeURIComponent
  const host = process.env.POSTGRES_HOST ?? 'localhost'
  const port = process.env.POSTGRES_PORT ?? '5432'
  const database = process.env.POSTGRES_DB ?? 'postgres'
  return `postgresql://${enc(user)}:${enc(password)}@${host}:${port}/${database}`
}

export async function bulkUpsertWithRust(
  updatesJson: string,
  connString: string
): Promise<string> {
  const addon = loadBulkUpsert()
  if (!addon) throw new Error('pg-bulk-upsert addon not loaded')
  return addon.bulkUpsertEscrows(updatesJson, connString)
}

export function assertBulkUpsertAvailable(): void {
  if (!loadBulkUpsert()) throw new Error('pg-bulk-upsert addon not loaded')
}

export function __setBulkUpsertForTests(
  mock: BulkUpsertAddon | null | undefined
): void {
  bulkUpsertOverride = mock
  bulkUpsert = null
  bulkUpsertLoadFailed = false
}

export function __resetBulkUpsertForTests(): void {
  bulkUpsertOverride = undefined
  bulkUpsert = null
  bulkUpsertLoadFailed = false
}
