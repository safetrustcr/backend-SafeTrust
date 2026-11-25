/**
 * @file webhook/src/repositories/escrow.repository.ts
 * @description Escrow repository with atomic freshness-checked operations (Issue #661).
 *
 * Core Ordering & State Invariants:
 * ─────────────────────────────────
 * 1. Why `received_at` is NOT a valid ordering proxy:
 *    `received_at` represents server-side observation arrival time, not on-chain occurrence.
 *    Network congestion, message retries, worker scheduling, and HTTP jitter mean that a snapshot
 *    reflecting an older blockchain state can arrive after a newer one. Using `received_at` as an
 *    ordering proxy results in silent regressions where stale snapshots overwrite newer confirmed
 *    states. The only authoritative ordering token is the ledger sequence number (`ledger_seq`).
 *
 * 2. The Unversioned Snapshot Policy:
 *    When an incoming observation provides no `ledger_seq` (unversioned snapshot):
 *    - It cannot prove state freshness against on-chain history.
 *    - It may ONLY write to unconfirmed pending records (`created`, `pending_funding`).
 *    - It is strictly REJECTED for any confirmed or terminal record (`funded`, `completed`, etc.).
 *    - Nonzero stored balances are never zeroed out by unversioned snapshots.
 *
 * 3. The Four Conflict Cases & Invariant Enforcement:
 *    - Case 1: Incoming newer (incoming_seq > stored_seq or stored is NULL): Write succeeds
 *              if state machine transition and terminal state rules allow.
 *    - Case 2: Incoming older (incoming_seq < stored_seq): Rejected silently; no write, no error.
 *    - Case 3: Duplicate/replay (same seq, same values): Idempotent no-op; no write, no error.
 *    - Case 4: Equal seq, different values: Preserve stored confirmed state; emit conflict log.
 *
 * 4. Terminal State Protection (Absorbing States):
 *    Terminal states (`completed`, `resolved`, `cancelled`) represent legally and financially
 *    final settlement. Once reached, an escrow is permanently closed. Terminal states must
 *    NEVER transition or be overwritten by any subsequent observation regardless of sequence
 *    number or numeric status ranking.
 */

import { PoolClient } from 'pg'
import { query, connect, withTransaction, type Queryable } from '../db/pool'
import {
  evaluateFreshness,
  formatExactBalance,
  FreshnessOutcome,
  IncomingEscrowObservation,
  StoredEscrowState,
} from '../lib/escrow-freshness'
import {
  getValidPriorStates,
  StateConflictError,
  StaleStateError,
} from '../lib/escrow-transitions'
import { EscrowStatus as CanonicalStatus, EscrowEventType } from '../types/escrow.types'

export { StateConflictError, StaleStateError }

/**
 * True only for PostgreSQL errors where retrying against the unqualified table
 * name is a legitimate recovery: `42P01` (undefined_table) or `3F000`
 * (invalid_schema_name). Any other error (lock/statement timeout, deadlock,
 * constraint violation) must propagate so the original cause is not masked by a
 * misleading "relation does not exist" from the fallback query.
 */
function isUndefinedTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code
  return code === '42P01' || code === '3F000'
}

export type EscrowStatus =
  | 'created'
  | 'funded'
  | 'milestone_approved'
  | 'completed'
  | 'disputed'
  | 'resolved'
  | string

export interface TrustlessWorkEscrow {
  id: string
  contractId: string
  engagementId?: string | null
  approver?: string | null
  serviceProvider?: string | null
  platformAddress?: string | null
  releaseSigner?: string | null
  disputeResolver?: string | null
  receiver?: string | null
  flags?: Record<string, boolean> | null
  status: EscrowStatus
  balance?: number
  createdAt?: string
  tenantId?: string
}

export interface CreateEscrowInput {
  contractId: string
  engagementId?: string | null
  approver: string
  serviceProvider?: string | null
  platformAddress?: string | null
  releaseSigner?: string | null
  disputeResolver?: string | null
  receiver?: string | null
  flags?: Record<string, boolean> | null
  /** @deprecated Pre-V1 alias retained while initialization callers migrate. */
  marker: string
  /** @deprecated Pre-V1 alias retained while initialization callers migrate. */
  releaser: string
  /** @deprecated Pre-V1 alias retained while initialization callers migrate. */
  resolver?: string | null
  escrowType: string
  status: string
  assetCode: string
  assetIssuer?: string | null
  amount: number
  balance: number
  tenantId: string
  escrowMetadata?: unknown
}

/**
 * Retrieves an escrow record by its on-chain contract ID.
 *
 * @param contractId - On-chain contract identifier
 * @returns Escrow record if found, or null
 */
export async function getEscrowByContractId(
  contractId: string
): Promise<TrustlessWorkEscrow | null> {
  const result = await query<{
    id: string
    contract_id: string
    engagement_id?: string | null
    approver?: string | null
    service_provider?: string | null
    platform_address?: string | null
    release_signer?: string | null
    dispute_resolver?: string | null
    receiver?: string | null
    flags?: Record<string, boolean> | null
    status: string
    balance?: number | string
    created_at?: string | Date
    tenant_id?: string
  }>(
    `SELECT
       id,
       contract_id,
       engagement_id,
       approver,
       service_provider,
       platform_address,
       release_signer,
       dispute_resolver,
       receiver,
       flags,
       status,
       balance,
       created_at,
       tenant_id
     FROM safetrust.trustless_work_escrows
     WHERE contract_id = $1
     LIMIT 1`,
    [contractId]
  )

  const escrow = result.rows[0]
  if (!escrow) {
    return null
  }

  return {
    id: escrow.id,
    contractId: escrow.contract_id,
    ...(escrow.engagement_id !== undefined && { engagementId: escrow.engagement_id }),
    ...(escrow.approver !== undefined && { approver: escrow.approver }),
    ...(escrow.service_provider !== undefined && { serviceProvider: escrow.service_provider }),
    ...(escrow.platform_address !== undefined && { platformAddress: escrow.platform_address }),
    ...(escrow.release_signer !== undefined && { releaseSigner: escrow.release_signer }),
    ...(escrow.dispute_resolver !== undefined && { disputeResolver: escrow.dispute_resolver }),
    ...(escrow.receiver !== undefined && { receiver: escrow.receiver }),
    ...(escrow.flags !== undefined && { flags: escrow.flags }),
    status: escrow.status,
    balance: escrow.balance !== undefined && escrow.balance !== null ? Number(escrow.balance) : undefined,
    createdAt: escrow.created_at instanceof Date ? escrow.created_at.toISOString() : escrow.created_at,
    tenantId: escrow.tenant_id,
  }
}

/**
 * Guarded status updater for escrow records.
 *
 * Audit Note (ARCH-A5):
 * Every canonical lifecycle status mutation MUST supply validPriorStates to
 * enforce the state machine transition table. An atomic status guard is
 * always applied and StateConflictError is thrown if 0 rows are affected.
 * (Reconciliation uses separate, explicitly documented UPSERT overrides.)
 *
 * @param contractId - On-chain contract identifier
 * @param status - Target escrow status
 * @param validPriorStates - Allowed prior statuses (required guard)
 * @throws StateConflictError if 0 rows match the contractId and validPriorStates
 */
export async function updateEscrowStatus(
  contractId: string,
  status: EscrowStatus,
  validPriorStates: string[]
): Promise<void> {
  const result = await query(
    `UPDATE safetrust.trustless_work_escrows
     SET status = $1, updated_at = NOW()
     WHERE contract_id = $2
       AND status = ANY($3::varchar[])`,
    [status, contractId, validPriorStates]
  )

  if (!result.rowCount || result.rowCount === 0) {
    throw new StateConflictError(
      `Escrow cannot transition to ${status}: contractId '${contractId}' not found or current status not in [${validPriorStates.join(', ')}]`
    )
  }
}

/**
 * Inserts a new escrow record in the database.
 *
 * @param object - Escrow creation payload
 * @returns The newly created escrow record, or null on failure
 */
export async function createEscrow(
  object: CreateEscrowInput
): Promise<TrustlessWorkEscrow | null> {
  const result = await query<{
    id: string
    contract_id: string
    status: string
    created_at?: string | Date
    tenant_id?: string
  }>(
    `INSERT INTO safetrust.trustless_work_escrows (
       contract_id,
       marker,
       approver,
       releaser,
       resolver,
       escrow_type,
       status,
       asset_code,
       asset_issuer,
       amount,
       balance,
       tenant_id,
       escrow_metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, contract_id, status, created_at, tenant_id`,
    [
      object.contractId,
      object.marker,
      object.approver,
      object.releaser,
      object.resolver ?? null,
      object.escrowType,
      object.status,
      object.assetCode,
      object.assetIssuer ?? null,
      object.amount,
      object.balance,
      object.tenantId,
      object.escrowMetadata ?? null,
    ]
  )

  const inserted = result.rows[0]
  if (!inserted) {
    return null
  }

  return {
    id: inserted.id,
    contractId: inserted.contract_id,
    status: inserted.status,
    createdAt: inserted.created_at instanceof Date ? inserted.created_at.toISOString() : inserted.created_at,
    tenantId: inserted.tenant_id,
  }
}

/**
 * Idempotently inserts an escrow record, updating contract_id on conflict
 * so repeated initialize webhooks return the existing row.
 */
export async function upsertEscrow(
  object: CreateEscrowInput
): Promise<TrustlessWorkEscrow | null> {
  const result = await query<{
    id: string
    contract_id: string
    status: string
    created_at?: string | Date
    tenant_id?: string
  }>(
    `INSERT INTO safetrust.trustless_work_escrows (
       contract_id,
       marker,
       approver,
       releaser,
       resolver,
       escrow_type,
       status,
       asset_code,
       asset_issuer,
       amount,
       balance,
       tenant_id,
       escrow_metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (contract_id) DO UPDATE
       SET contract_id = EXCLUDED.contract_id
     RETURNING id, contract_id, status, created_at, tenant_id`,
    [
      object.contractId,
      object.marker,
      object.approver,
      object.releaser,
      object.resolver ?? null,
      object.escrowType,
      object.status,
      object.assetCode,
      object.assetIssuer ?? null,
      object.amount,
      object.balance,
      object.tenantId,
      object.escrowMetadata ?? null,
    ]
  )

  const inserted = result.rows[0]
  if (!inserted) {
    return null
  }

  return {
    id: inserted.id,
    contractId: inserted.contract_id,
    status: inserted.status,
    createdAt: inserted.created_at instanceof Date ? inserted.created_at.toISOString() : inserted.created_at,
    tenantId: inserted.tenant_id,
  }
}

/**
 * Approves a specific milestone for an escrow.
 *
 * @param escrowId - Internal UUID of the escrow
 * @param milestoneId - Identifier of the milestone
 * @param approver - Address or identity of the approver
 * @param approvedAt - ISO timestamp of approval
 * @returns Boolean indicating whether any rows were updated
 */
export async function approveMilestone(
  escrowId: string,
  milestoneId: string,
  approver: string,
  approvedAt: string
): Promise<boolean> {
  const result = await query(
    `UPDATE safetrust.escrow_milestones
     SET status = 'approved',
         approved_by = $1,
         approved_at = $2,
         updated_at = $2
     WHERE escrow_id = $3
       AND milestone_id = $4`,
    [approver, approvedAt, escrowId, milestoneId]
  )

  return Boolean(result.rowCount)
}

/**
 * Transitions an escrow's status to milestone_approved with a prior-state guard.
 *
 * @param escrowId - Internal UUID of the escrow
 * @param approvedAt - ISO timestamp of approval
 * @param validStates - Allowed prior statuses
 * @returns Boolean indicating whether any rows were updated
 */
export async function approveEscrowStatus(
  escrowId: string,
  approvedAt: string,
  validStates: string[]
): Promise<boolean> {
  const result = await query(
    `UPDATE safetrust.trustless_work_escrows
     SET status = 'milestone_approved',
         updated_at = $1
     WHERE id = $2
       AND status = ANY($3::varchar[])`,
    [approvedAt, escrowId, validStates]
  )

  return Boolean(result.rowCount)
}

/**
 * Updates an escrow status to funded with a prior-state guard.
 * Supports db: Queryable as first argument, or uses the default pg pool.
 */
export async function fundEscrow(
  contractId: string,
  amount: number,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null>
export async function fundEscrow(
  db: Queryable,
  contractId: string,
  amount: number,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null>
export async function fundEscrow(
  dbOrContractId: Queryable | string,
  contractIdOrAmount: string | number,
  amountOrValidStates: number | string[],
  maybeValidStates?: string[]
): Promise<TrustlessWorkEscrow | null> {
  if (typeof dbOrContractId === 'string') {
    const contractId = dbOrContractId
    const amount = contractIdOrAmount as number
    const validStates = amountOrValidStates as string[]

    const result = await query<{
      id: string
      contract_id: string
      status: string
      balance: number | string
    }>(
      `UPDATE safetrust.trustless_work_escrows
       SET status = 'funded',
           balance = $1,
           updated_at = NOW()
       WHERE contract_id = $2
         AND status = ANY($3::varchar[])
       RETURNING id, contract_id, status, balance`,
      [amount, contractId, validStates]
    )

    const updated = result.rows[0]
    if (!updated) {
      return null
    }

    return {
      id: updated.id,
      contractId: updated.contract_id,
      status: updated.status,
      balance: Number(updated.balance),
    }
  }

  const db = dbOrContractId as Queryable
  const contractId = contractIdOrAmount as string
  const amount = amountOrValidStates as number
  const validStates = maybeValidStates as string[]

  const result = await db.query<{
    id: string
    contract_id: string
    status: string
    balance: number
  }>(
    `UPDATE safetrust.trustless_work_escrows
     SET status = 'funded', balance = $1, updated_at = NOW()
     WHERE contract_id = $2
       AND tenant_id = 'safetrust'
       AND status = ANY($3::varchar[])
     RETURNING id, contract_id, status, balance`,
    [amount, contractId, validStates]
  )

  const updated = result.rows[0]
  return updated
    ? {
        id: updated.id,
        contractId: updated.contract_id,
        status: updated.status,
        balance: updated.balance,
      }
    : null
}

/**
 * Releases funds and transitions an escrow status to completed with a prior-state guard.
 * Supports db: Queryable as first argument, with backward-compatible GraphQL fallback.
 */
export async function releaseFunds(
  contractId: string,
  validStates?: string[]
): Promise<TrustlessWorkEscrow>
export async function releaseFunds(
  db: Queryable,
  contractId: string,
  validStates?: string[]
): Promise<TrustlessWorkEscrow>
export async function releaseFunds(
  dbOrContractId: Queryable | string,
  contractIdOrValidStates?: string | string[],
  maybeValidStates?: string[]
): Promise<TrustlessWorkEscrow> {
  const isQueryable = typeof dbOrContractId !== 'string'

  let db: Queryable | undefined
  let contractId: string
  let validStates: string[] | undefined

  if (isQueryable) {
    db = dbOrContractId as Queryable
    contractId = contractIdOrValidStates as string
    validStates = maybeValidStates
  } else {
    contractId = dbOrContractId as string
    validStates = contractIdOrValidStates as string[] | undefined
  }

  const canonicalPriorStates = getValidPriorStates(
    CanonicalStatus.Completed,
    EscrowEventType.FundsReleased
  )
  const allowedPriorStates =
    validStates === undefined
      ? canonicalPriorStates
      : validStates.filter((state) => canonicalPriorStates.includes(state))

  if (!isQueryable || !db) {
    const result = await query<{
      id: string
      contract_id: string
      status: string
      balance: number | string
    }>(
      `UPDATE safetrust.trustless_work_escrows
       SET status = 'completed',
           balance = 0,
           updated_at = NOW()
       WHERE contract_id = $1
         AND status = ANY($2::varchar[])
       RETURNING id, contract_id, status, balance`,
      [contractId, allowedPriorStates]
    )

    const updated = result.rows[0]
    if (!updated) {
      throw new StateConflictError(
        `Escrow cannot transition to completed: contractId '${contractId}' not found or current status not in [${allowedPriorStates.join(', ')}]`
      )
    }

    return {
      id: updated.id,
      contractId: updated.contract_id,
      status: updated.status,
      balance: Number(updated.balance),
    }
  }

  const result = await db.query<{
    id: string
    contract_id: string
    status: string
    balance: number
  }>(
    `UPDATE safetrust.trustless_work_escrows
     SET status = 'completed', balance = 0, updated_at = NOW()
     WHERE contract_id = $1
       AND tenant_id = 'safetrust'
       AND status = ANY($2::varchar[])
     RETURNING id, contract_id, status, balance`,
    [contractId, allowedPriorStates]
  )

  const updated = result.rows[0]
  if (!updated) {
    throw new StateConflictError(
      `Escrow cannot transition to completed: contractId '${contractId}' not found or current status not in [${allowedPriorStates.join(', ')}]`
    )
  }

  return {
    id: updated.id,
    contractId: updated.contract_id,
    status: updated.status,
    balance: updated.balance,
  }
}

/**
 * Transitions an escrow status to disputed with a prior-state guard.
 *
 * @param contractId - On-chain contract identifier
 * @param validStates - Allowed prior statuses
 * @returns Updated escrow record or null
 */
export async function disputeEscrow(
  contractId: string,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const result = await query<{
    id: string
    contract_id: string
    status: string
  }>(
    `UPDATE safetrust.trustless_work_escrows
     SET status = 'disputed',
         updated_at = NOW()
     WHERE contract_id = $1
       AND status = ANY($2::varchar[])
     RETURNING id, contract_id, status`,
    [contractId, validStates]
  )

  const updated = result.rows[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contract_id,
    status: updated.status,
  }
}

/**
 * Transitions an escrow status to resolved with a prior-state guard.
 *
 * @param contractId - On-chain contract identifier
 * @param validStates - Allowed prior statuses
 * @returns Updated escrow record or null
 */
export async function resolveDispute(
  contractId: string,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const result = await query<{
    id: string
    contract_id: string
    status: string
    balance: number | string
  }>(
    `UPDATE safetrust.trustless_work_escrows
     SET status = 'resolved',
         balance = 0,
         updated_at = NOW()
     WHERE contract_id = $1
       AND status = ANY($2::varchar[])
     RETURNING id, contract_id, status, balance`,
    [contractId, validStates]
  )

  const updated = result.rows[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contract_id,
    status: updated.status,
    balance: Number(updated.balance),
  }
}

/**
 * Appends a resolution note to an escrow's metadata.
 *
 * @param contractId - On-chain contract identifier
 * @param note - Resolution note payload
 * @returns Boolean indicating whether any rows were updated
 */
export async function appendResolutionNote(
  contractId: string,
  note: Record<string, unknown>
): Promise<boolean> {
  const result = await query(
    `UPDATE safetrust.trustless_work_escrows
     SET escrow_metadata = COALESCE(escrow_metadata, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE contract_id = $2`,
    [JSON.stringify(note), contractId]
  )

  return Boolean(result.rowCount)
}

export interface EscrowObservationInput {
  status: string
  balance?: string | number
  amount?: string | number
  ledgerSeq?: bigint | number | string | null
  network?: string | null
}

/**
 * Executes an atomic freshness-checked write on trustless_work_escrows.
 *
 * Implements the atomic transaction pattern:
 * ```sql
 * BEGIN;
 * SELECT ledger_seq, status FROM trustless_work_escrows WHERE id = $1 FOR UPDATE;
 * -- compare in application code
 * UPDATE trustless_work_escrows SET status = $2, balance = $3, ledger_seq = $4 WHERE id = $1;
 * COMMIT;
 * ```
 *
 * Guarantees zero TOCTOU gap by locking the row within the single transaction.
 * Evaluates the four conflict cases, unversioned snapshot rules, terminal state protection,
 * network/contract identity checks, and exact token amount preservation.
 */
interface EscrowTransactionRow {
  id: string
  contract_id: string
  status: string
  balance: string | null
  ledger_seq: bigint | string | null
  network: string | null
}

export async function updateEscrowWithFreshness(
  dbOrId: Queryable | string,
  idOrObservation: string | EscrowObservationInput,
  observationOrClient?: EscrowObservationInput | Queryable
): Promise<FreshnessOutcome> {
  let db: Queryable | null = null
  let idOrContractId: string
  let observation: EscrowObservationInput

  if (typeof dbOrId === 'string') {
    idOrContractId = dbOrId
    observation = idOrObservation as EscrowObservationInput
    db = (observationOrClient as Queryable) ?? null
  } else {
    db = dbOrId
    idOrContractId = idOrObservation as string
    observation = observationOrClient as EscrowObservationInput
  }

  if (!db) {
    return withTransaction((txClient) =>
      updateEscrowWithFreshness(txClient, idOrContractId, observation)
    )
  }

  // Caller owns transaction lifecycle when providing Queryable; updateEscrowWithFreshness preserves savepoint behavior
  const selectSql = `
    SELECT id, contract_id, status, balance::text, ledger_seq, network
    FROM safetrust.trustless_work_escrows
    WHERE id::text = $1 OR contract_id = $1
    FOR UPDATE
  `
  let storedRow: EscrowTransactionRow | null = null
  await db.query('SAVEPOINT sp_select')
  try {
    const res = await db.query<EscrowTransactionRow>(selectSql, [idOrContractId])
    storedRow = res.rows[0] ?? null
    await db.query('RELEASE SAVEPOINT sp_select')
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT sp_select')
    if (!isUndefinedTableError(err)) throw err
    // Fall back to unqualified trustless_work_escrows table if safetrust schema is not configured
    const fallbackSql = `
      SELECT id, contract_id, status, balance::text, ledger_seq, network
      FROM trustless_work_escrows
      WHERE id::text = $1 OR contract_id = $1
      FOR UPDATE
    `
    const res = await db.query<EscrowTransactionRow>(fallbackSql, [idOrContractId])
    storedRow = res.rows[0] ?? null
  }

  const storedState: StoredEscrowState | null = storedRow
    ? {
        id: storedRow.id,
        contractId: storedRow.contract_id,
        status: storedRow.status,
        balance: storedRow.balance ?? '0.0000000',
        ledgerSeq: storedRow.ledger_seq,
        network: storedRow.network,
      }
    : null

  const incoming: IncomingEscrowObservation = {
    contractId: storedState?.contractId ?? idOrContractId,
    status: observation.status,
    balance: observation.balance ?? (storedState?.balance ?? '0.0000000'),
    amount: observation.amount,
    ledgerSeq: observation.ledgerSeq,
    network: observation.network,
  }

  // CodeRabbit review comment: Reject missing-row observations instead of inserting placeholders
  const outcome: FreshnessOutcome = storedRow
    ? evaluateFreshness(storedState, incoming)
    : {
        type: 'REJECT_INVALID_TRANSITION',
        reason: 'Cannot create an escrow row without an existing escrow identity',
      }

  if (outcome.type === 'WRITE' && storedRow) {
    // Update existing row
    const updateSql = `
      UPDATE safetrust.trustless_work_escrows
      SET status = $2, balance = $3::numeric, ledger_seq = $4,
          network = COALESCE(safetrust.trustless_work_escrows.network, $5),
          updated_at = NOW()
      WHERE id::text = $1 OR contract_id = $1
    `
    await db.query('SAVEPOINT sp_update')
    try {
      await db.query(updateSql, [
        idOrContractId,
        outcome.status,
        outcome.balance,
        outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
        incoming.network ?? null,
      ])
      await db.query('RELEASE SAVEPOINT sp_update')
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT sp_update')
      if (!isUndefinedTableError(err)) throw err
      const fallbackUpdate = `
        UPDATE trustless_work_escrows
        SET status = $2, balance = $3::numeric, ledger_seq = $4,
            network = COALESCE(trustless_work_escrows.network, $5),
            updated_at = NOW()
        WHERE id::text = $1 OR contract_id = $1
      `
      await db.query(fallbackUpdate, [
        idOrContractId,
        outcome.status,
        outcome.balance,
        outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
        incoming.network ?? null,
      ])
    }
  }

  return outcome
}

export const applyEscrowFreshnessUpdate = updateEscrowWithFreshness
