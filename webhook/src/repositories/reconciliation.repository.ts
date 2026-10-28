import db from '../services/db'
import {
  assertBulkUpsertAvailable,
  bulkUpsertWithRust,
  buildConnectionString,
  isRustBulkUpsertEnabled,
} from '../lib/native-adapters/rust-upsert.adapter'
import { CANONICAL_TRANSITIONS, balancesEqual } from '../lib/escrow-freshness'
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
  ledger_seq: string | null
  network: string | null
}

const SQL_TRANSITION_RULES = Object.entries(CANONICAL_TRANSITIONS)
  .filter(([, targets]) => targets.length > 0)
  .map(
    ([from, targets]) =>
      `(safetrust.trustless_work_escrows.status = '${from}' AND EXCLUDED.status IN (${targets
        .map((target) => `'${target}'`)
        .join(', ')}))`
  )
  .join(' OR\n        ')

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
    ledger_seq,
    network,
    updated_at,
    tenant_id
  )
  SELECT $1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, NOW(), 'safetrust'
  WHERE $2 IN ('created', 'pending_funding')
  ON CONFLICT (contract_id)
  DO UPDATE SET
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    balance    = CASE
      WHEN safetrust.trustless_work_escrows.balance > 0 AND EXCLUDED.balance = 0
        THEN safetrust.trustless_work_escrows.balance
      ELSE EXCLUDED.balance
    END,
    marker     = COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
    approver   = COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
    releaser   = COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser),
    network    = COALESCE(NULLIF(TRIM(safetrust.trustless_work_escrows.network), ''), NULLIF(TRIM(EXCLUDED.network), '')),
    updated_at = NOW()
  WHERE (
    safetrust.trustless_work_escrows.status IN ('created', 'pending_funding')
    AND (
      safetrust.trustless_work_escrows.status = EXCLUDED.status
      OR (${SQL_TRANSITION_RULES})
    )
    AND (
      safetrust.trustless_work_escrows.network IS NULL
      OR NULLIF(TRIM(safetrust.trustless_work_escrows.network), '') IS NULL
      OR EXCLUDED.network IS NULL
      OR NULLIF(TRIM(EXCLUDED.network), '') IS NULL
      OR LOWER(REGEXP_REPLACE(safetrust.trustless_work_escrows.network, '^stellar:', '', 'i')) =
         LOWER(REGEXP_REPLACE(EXCLUDED.network, '^stellar:', '', 'i'))
    )
    AND (
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
    COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
    COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
    COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser)
    )
  )
  RETURNING contract_id, (xmax = 0) AS inserted
`

const UPSERT_ESCROW_WITH_SEQ_SQL = `
  INSERT INTO safetrust.trustless_work_escrows (
    contract_id,
    status,
    amount,
    balance,
    marker,
    approver,
    releaser,
    escrow_type,
    ledger_seq,
    network,
    updated_at,
    tenant_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'safetrust')
  ON CONFLICT (contract_id)
  DO UPDATE SET
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    balance    = EXCLUDED.balance,
    marker     = COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
    approver   = COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
    releaser   = COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser),
    ledger_seq = EXCLUDED.ledger_seq,
    network    = COALESCE(NULLIF(TRIM(safetrust.trustless_work_escrows.network), ''), NULLIF(TRIM(EXCLUDED.network), '')),
    updated_at = NOW()
  WHERE (
    safetrust.trustless_work_escrows.status NOT IN ('completed', 'resolved', 'cancelled')
    AND (
      safetrust.trustless_work_escrows.ledger_seq IS NULL
      OR EXCLUDED.ledger_seq > safetrust.trustless_work_escrows.ledger_seq
    )
    AND (
      safetrust.trustless_work_escrows.status = EXCLUDED.status
      OR (${SQL_TRANSITION_RULES})
    )
    AND (
      safetrust.trustless_work_escrows.network IS NULL
      OR NULLIF(TRIM(safetrust.trustless_work_escrows.network), '') IS NULL
      OR EXCLUDED.network IS NULL
      OR NULLIF(TRIM(EXCLUDED.network), '') IS NULL
      OR LOWER(REGEXP_REPLACE(safetrust.trustless_work_escrows.network, '^stellar:', '', 'i')) =
         LOWER(REGEXP_REPLACE(EXCLUDED.network, '^stellar:', '', 'i'))
    )
    AND (
      safetrust.trustless_work_escrows.ledger_seq,
      safetrust.trustless_work_escrows.status,
      safetrust.trustless_work_escrows.amount,
      safetrust.trustless_work_escrows.balance,
      safetrust.trustless_work_escrows.marker,
      safetrust.trustless_work_escrows.approver,
      safetrust.trustless_work_escrows.releaser
    ) IS DISTINCT FROM (
      EXCLUDED.ledger_seq,
      EXCLUDED.status,
      EXCLUDED.amount,
      EXCLUDED.balance,
      COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
      COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
      COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser)
    )
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
      const seq = escrow.ledgerSeq ?? escrow.ledger_seq
      const params = [
        escrow.contractId,
        escrow.status ?? 'created',
        escrow.amount ?? 0,
        escrow.balance ?? 0,
        escrow.roles?.marker ?? '',
        escrow.roles?.approver ?? '',
        escrow.roles?.releaser ?? '',
        escrow.escrowType ?? 'single_release',
      ]
      const result =
        seq !== undefined && seq !== null
          ? await db.query<{ contract_id: string }>(UPSERT_ESCROW_WITH_SEQ_SQL, [
              ...params,
              typeof seq === 'bigint' ? seq.toString() : seq,
              escrow.network ?? null,
            ])
          : await db.query<{ contract_id: string }>(UPSERT_ESCROW_SQL, [
              ...params,
              escrow.network ?? null,
            ])

      if (result.rows.length > 0) {
        updated++
      } else {
        if (seq !== undefined && seq !== null) {
          const { rows: storedRows } = await db.query<{
            ledger_seq: string | null
            status: string
            balance: string | null
          }>(
            `SELECT ledger_seq::text, status, balance::text
               FROM safetrust.trustless_work_escrows
              WHERE contract_id = $1`,
            [escrow.contractId]
          )
          const stored = storedRows[0]
          if (
            stored?.ledger_seq !== null &&
            stored?.ledger_seq !== undefined &&
            BigInt(stored.ledger_seq) === BigInt(seq) &&
            (stored.status !== (escrow.status ?? 'created') ||
              !balancesEqual(stored.balance, escrow.balance))
          ) {
            console.warn(
              `[reconciliation] Equal-sequence conflict on contract "${escrow.contractId}" at seq ${seq}`
            )
          }
        }
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

  const updates: BulkUpsertRow[] = valid.map((escrow) => {
    const seq = escrow.ledgerSeq ?? escrow.ledger_seq
    return {
      contract_id: escrow.contractId,
      status: escrow.status ?? 'created',
      amount: String(escrow.amount ?? 0),
      balance: String(escrow.balance ?? 0),
      marker: escrow.roles?.marker ?? '',
      approver: escrow.roles?.approver ?? '',
      releaser: escrow.roles?.releaser ?? '',
      escrow_type: escrow.escrowType ?? 'single_release',
      ledger_seq: seq == null ? null : typeof seq === 'bigint' ? seq.toString() : String(seq),
      network: escrow.network ?? null,
    }
  })

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
