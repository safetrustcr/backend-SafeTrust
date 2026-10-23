import db from '../services/db'
import {
  assertBulkUpsertAvailable,
  bulkUpsertWithRust,
  buildConnectionString,
  isRustBulkUpsertEnabled,
} from '../lib/native-adapters/rust-upsert.adapter'
import type {
  BulkUpsertResult,
  EscrowRecord,
  ReconciliationEscrowRow,
  UpsertResult,
} from '../lib/reconciliation.types'

interface BulkUpsertRow {
  contract_id: string
  status: string
  amount: string
  balance: string
  marker: string
  approver: string
  releaser: string
  escrow_type: string
}

const UPSERT_ESCROW_SQL = `
  INSERT INTO safetrust.trustless_work_escrows (
    contract_id,
    status,
    amount,
    balance,
    marker,
    approver,
    releaser,
    escrow_type,
    updated_at,
    tenant_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'safetrust')
  ON CONFLICT (contract_id)
  DO UPDATE SET
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    balance    = EXCLUDED.balance,
    marker     = EXCLUDED.marker,
    approver   = EXCLUDED.approver,
    releaser   = EXCLUDED.releaser,
    updated_at = NOW()
  WHERE (
    safetrust.trustless_work_escrows.status,
    safetrust.trustless_work_escrows.amount,
    safetrust.trustless_work_escrows.balance,
    safetrust.trustless_work_escrows.marker,
    safetrust.trustless_work_escrows.approver,
    safetrust.trustless_work_escrows.releaser
  ) IS DISTINCT FROM (
    EXCLUDED.status,
    EXCLUDED.amount,
    EXCLUDED.balance,
    EXCLUDED.marker,
    EXCLUDED.approver,
    EXCLUDED.releaser
  )
  RETURNING contract_id, (xmax = 0) AS inserted
`

export async function fetchEscrowContractIds(
  tenantId = 'safetrust'
): Promise<string[]> {
  const { rows } = await db.query<{ contract_id: string }>(
    `SELECT contract_id
       FROM safetrust.trustless_work_escrows
      WHERE tenant_id = $1`,
    [tenantId]
  )
  return rows.map((row) => row.contract_id)
}

export async function fetchSorobanEscrowRows(): Promise<ReconciliationEscrowRow[]> {
  const { rows } = await db.query<ReconciliationEscrowRow>(
    `SELECT contract_id, id, status, balance, marker, approver
       FROM safetrust.trustless_work_escrows
      WHERE tenant_id = 'safetrust'`
  )
  return rows
}

export async function upsertEscrows(escrows: EscrowRecord[]): Promise<UpsertResult> {
  let updated = 0
  let unchanged = 0
  let skipped = 0

  for (const escrow of escrows) {
    if (!escrow?.contractId) {
      console.warn('[reconciliation] ⚠️  Skipping escrow without contractId:', escrow)
      skipped++
      continue
    }

    try {
      const result = await db.query<{ contract_id: string }>(UPSERT_ESCROW_SQL, [
        escrow.contractId,
        escrow.status ?? 'created',
        escrow.amount ?? 0,
        escrow.balance ?? 0,
        escrow.roles?.marker ?? '',
        escrow.roles?.approver ?? '',
        escrow.roles?.releaser ?? '',
        escrow.escrowType ?? 'single_release',
      ])

      if (result.rows.length > 0) {
        updated++
      } else {
        unchanged++
      }
    } catch (rowError) {
      console.error(
        `[reconciliation] ⚠️  Row error for contract_id "${escrow.contractId}":`,
        (rowError as Error).message
      )
      skipped++
    }
  }

  return { updated, unchanged, skipped }
}

export async function upsertEscrowsBulk(escrows: EscrowRecord[]): Promise<UpsertResult> {
  assertBulkUpsertAvailable()

  let skipped = 0
  const valid: EscrowRecord[] = []
  for (const escrow of escrows) {
    if (!escrow?.contractId) {
      console.warn('[reconciliation] ⚠️  Skipping escrow without contractId:', escrow)
      skipped++
      continue
    }
    valid.push(escrow)
  }

  if (valid.length === 0) {
    return { updated: 0, unchanged: 0, skipped }
  }

  const updates: BulkUpsertRow[] = valid.map((escrow) => ({
    contract_id: escrow.contractId,
    status: escrow.status ?? 'created',
    amount: String(escrow.amount ?? 0),
    balance: String(escrow.balance ?? 0),
    marker: escrow.roles?.marker ?? '',
    approver: escrow.roles?.approver ?? '',
    releaser: escrow.roles?.releaser ?? '',
    escrow_type: escrow.escrowType ?? 'single_release',
  }))

  const resultJson = await bulkUpsertWithRust(
    JSON.stringify(updates),
    buildConnectionString()
  )
  const result: BulkUpsertResult = JSON.parse(resultJson)

  return {
    updated: result.rows_affected,
    unchanged: result.unchanged,
    skipped,
  }
}

export async function upsertEscrowBatch(escrows: EscrowRecord[]): Promise<UpsertResult> {
  if (!isRustBulkUpsertEnabled() || escrows.length === 0) {
    return upsertEscrows(escrows)
  }
  try {
    return await upsertEscrowsBulk(escrows)
  } catch (err) {
    console.error(
      `[reconciliation] ⚠️  Bulk upsert failed, using row-by-row: ${(err as Error).message}`
    )
    return upsertEscrows(escrows)
  }
}

export async function findStaleEscrows(staleDays = 7): Promise<string[]> {
  if (!Number.isFinite(staleDays) || staleDays < 1) {
    throw new RangeError('findStaleEscrows: staleDays must be a positive number')
  }

  const { rows } = await db.query<{ contract_id: string }>(
    `SELECT contract_id
       FROM safetrust.trustless_work_escrows
      WHERE tenant_id = 'safetrust'
        AND status NOT IN ('completed', 'resolved', 'cancelled')
        AND updated_at < NOW() - ($1 * INTERVAL '1 day')
      ORDER BY updated_at ASC`,
    [staleDays]
  )

  return rows.map((r) => r.contract_id)
}
