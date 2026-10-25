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

import { hasuraRequest } from '../services/hasura'
import { PoolClient } from 'pg'
import { query, connect } from '../services/db'
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
  status: EscrowStatus
  balance?: number
  createdAt?: string
  tenantId?: string
}

export interface CreateEscrowInput {
  contractId: string
  marker: string
  approver: string
  releaser: string
  resolver?: string | null
  escrowType: string
  status: string
  assetCode: string
  assetIssuer?: string | null
  amount: number
  balance: number
  bookingId?: string | null
  roomId?: string | null
  hotelId?: string | null
  guestId?: string | null
  tenantId: string
  escrowMetadata?: unknown
  bookingMetadata?: unknown
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
  const query = `
    query GetEscrowByContractId($contractId: String!) {
      trustless_work_escrows(where: { contractId: { _eq: $contractId } }) {
        id
        contractId
        status
        balance
        createdAt
        tenantId
      }
    }
  `

  const data = await hasuraRequest<{
    trustless_work_escrows?: Array<{
      id: string
      contractId: string
      status: string
      balance?: number
      createdAt?: string
      tenantId?: string
    }>
  }>(query, { contractId })

  const escrow = data?.trustless_work_escrows?.[0]
  if (!escrow) {
    return null
  }

  return {
    id: escrow.id,
    contractId: escrow.contractId,
    status: escrow.status,
    balance: escrow.balance,
    createdAt: escrow.createdAt,
    tenantId: escrow.tenantId,
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
  const mutation = `
    mutation UpdateEscrowStatusWithGuard($contractId: String!, $status: String!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: { status: $status }
      ) {
        affected_rows
      }
    }
  `

  const variables = { contractId, status, validStates: validPriorStates }

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: { affected_rows: number }
  }>(mutation, variables)

  if (!data?.update_trustless_work_escrows?.affected_rows || data.update_trustless_work_escrows.affected_rows === 0) {
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
  const mutation = `
    mutation InitializeEscrow($object: trustless_work_escrows_insert_input!) {
      insert_trustless_work_escrows_one(object: $object) {
        id
        contractId
        status
        createdAt
      }
    }
  `

  const data = await hasuraRequest<{
    insert_trustless_work_escrows_one?: {
      id: string
      contractId: string
      status: string
      createdAt?: string
    }
  }>(mutation, { object })

  const inserted = data?.insert_trustless_work_escrows_one
  if (!inserted) {
    return null
  }

  return {
    id: inserted.id,
    contractId: inserted.contractId,
    status: inserted.status,
    createdAt: inserted.createdAt,
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
  const mutation = `
    mutation ApproveMilestone(
      $escrowId: uuid!
      $milestoneId: String!
      $approver: String!
      $approvedAt: timestamptz!
    ) {
      update_escrow_milestones(
        where: {
          escrowId: { _eq: $escrowId }
          milestoneId: { _eq: $milestoneId }
        }
        _set: {
          status: "approved"
          approvedBy: $approver
          approvedAt: $approvedAt
          updatedAt: $approvedAt
        }
      ) {
        affected_rows
      }
    }
  `

  const data = await hasuraRequest<{
    update_escrow_milestones?: { affected_rows: number }
  }>(mutation, { escrowId, milestoneId, approver, approvedAt })

  return Boolean(data?.update_escrow_milestones?.affected_rows)
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
  const mutation = `
    mutation ApproveEscrow($escrowId: uuid!, $approvedAt: timestamptz!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          id: { _eq: $escrowId }
          status: { _in: $validStates }
        }
        _set: {
          status: "milestone_approved"
          updatedAt: $approvedAt
        }
      ) {
        affected_rows
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: { affected_rows: number }
  }>(mutation, { escrowId, approvedAt, validStates })

  return Boolean(data?.update_trustless_work_escrows?.affected_rows)
}

/**
 * Updates an escrow status to funded with a prior-state guard via GraphQL mutation.
 *
 * @param contractId - On-chain contract identifier
 * @param amount - Deposit amount to set as balance
 * @param validStates - Allowed prior statuses
 * @returns Updated escrow record or null
 */
export async function fundEscrow(
  contractId: string,
  amount: number,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation FundEscrow($contractId: String!, $amount: numeric!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "funded"
          balance: $amount
        }
      ) {
        returning {
          id
          contractId
          status
          balance
        }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string; balance: number }>
    }
  }>(mutation, { contractId, amount, validStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
    balance: updated.balance,
  }
}

/**
 * Updates an escrow status to funded with a prior-state guard within an existing PostgreSQL transaction.
 *
 * @param client - PostgreSQL pool client
 * @param contractId - On-chain contract identifier
 * @param amount - Deposit amount to set as balance
 * @param validStates - Allowed prior statuses
 * @returns Updated escrow record or null
 */
export async function fundEscrowInTransaction(
  client: PoolClient,
  contractId: string,
  amount: number,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const result = await client.query<{
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
 * Throws StateConflictError if no row matches the allowed prior states.
 *
 * @param contractId - On-chain contract identifier
 * @param validStates - Optional allowed prior statuses; defaults to canonical valid states
 * @returns Updated escrow record
 * @throws StateConflictError if the escrow cannot transition to completed
 */
export async function releaseFunds(
  contractId: string,
  validStates?: string[]
): Promise<TrustlessWorkEscrow> {
  const canonicalPriorStates = getValidPriorStates(
    CanonicalStatus.Completed,
    EscrowEventType.FundsReleased
  )
  const allowedPriorStates =
    validStates === undefined
      ? canonicalPriorStates
      : validStates.filter((state) => canonicalPriorStates.includes(state))

  const mutation = `
    mutation ReleaseFunds($contractId: String!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "completed"
          balance: 0
        }
      ) {
        returning { id contractId status balance }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string; balance: number }>
    }
  }>(mutation, { contractId, validStates: allowedPriorStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    throw new StateConflictError(
      `Escrow cannot transition to completed: contractId '${contractId}' not found or current status not in [${allowedPriorStates.join(', ')}]`
    )
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
    balance: updated.balance,
  }
}

/**
 * Releases funds and transitions an escrow to completed with a prior-state guard in a transaction.
 *
 * @param client - PostgreSQL pool client
 * @param contractId - On-chain contract identifier
 * @param validStates - Allowed prior statuses
 * @returns Updated escrow record or null
 */
export async function releaseFundsInTransaction(
  client: PoolClient,
  contractId: string,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const result = await client.query<{
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
    [contractId, validStates]
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
  const mutation = `
    mutation DisputeEscrow($contractId: String!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "disputed"
        }
      ) {
        returning { id contractId status }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string }>
    }
  }>(mutation, { contractId, validStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
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
  const mutation = `
    mutation ResolveDispute($contractId: String!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "resolved"
          balance: 0
        }
      ) {
        returning { id contractId status balance }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string; balance: number }>
    }
  }>(mutation, { contractId, validStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
    balance: updated.balance,
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
  const mutation = `
    mutation AppendResolutionNote($contractId: String!, $note: jsonb!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
        _append: { escrowMetadata: $note }
      ) {
        affected_rows
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: { affected_rows: number }
  }>(mutation, { contractId, note })

  return Boolean(data?.update_trustless_work_escrows?.affected_rows)
}

export interface EscrowObservationInput {
  status: string
  balance?: string | number
  amount?: string | number
  ledgerSeq?: bigint | number | string | null
  network?: string | null
}

/**
 * Executes an atomic freshness-checked write on escrow_transactions.
 *
 * Implements the atomic transaction pattern:
 * ```sql
 * BEGIN;
 * SELECT ledger_seq, status FROM escrow_transactions WHERE id = $1 FOR UPDATE;
 * -- compare in application code
 * UPDATE escrow_transactions SET status = $2, balance = $3, ledger_seq = $4 WHERE id = $1;
 * COMMIT;
 * ```
 *
 * Guarantees zero TOCTOU gap by locking the row within the single transaction.
 * Evaluates the four conflict cases, unversioned snapshot rules, terminal state protection,
 * network/contract identity checks, and exact token amount preservation.
 */
export async function updateEscrowWithFreshness(
  idOrContractId: string,
  observation: EscrowObservationInput,
  providedClient?: PoolClient
): Promise<FreshnessOutcome> {
  const isCustomClient = Boolean(providedClient)
  const client =
    providedClient ?? (typeof connect === 'function' ? await connect() : null)

  const executeQuery = async (
    sql: string,
    params: any[] = []
  ): Promise<{ rows: any[] }> => {
    if (client) {
      return client.query(sql, params)
    }
    return query(sql, params)
  }

  let txOpen = false
  try {
    await executeQuery('BEGIN')
    txOpen = true

    // Select with FOR UPDATE (row-level lock)
    // Supports either UUID id or contract_id string
    const selectSql = `
      SELECT id, contract_id, status, balance::text, ledger_seq, network
      FROM safetrust.escrow_transactions
      WHERE id::text = $1 OR contract_id = $1
      FOR UPDATE
    `
    let storedRow: any = null
    await executeQuery('SAVEPOINT sp_select')
    try {
      const res = await executeQuery(selectSql, [idOrContractId])
      storedRow = res.rows[0]
      await executeQuery('RELEASE SAVEPOINT sp_select')
    } catch {
      await executeQuery('ROLLBACK TO SAVEPOINT sp_select')
      // Fall back to unqualified escrow_transactions table if safetrust schema is not configured
      const fallbackSql = `
        SELECT id, contract_id, status, balance::text, ledger_seq, network
        FROM escrow_transactions
        WHERE id::text = $1 OR contract_id = $1
        FOR UPDATE
      `
      const res = await executeQuery(fallbackSql, [idOrContractId])
      storedRow = res.rows[0]
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
        UPDATE safetrust.escrow_transactions
        SET status = $2, balance = $3::numeric, ledger_seq = $4,
            network = COALESCE(safetrust.escrow_transactions.network, $5),
            updated_at = NOW()
        WHERE id::text = $1 OR contract_id = $1
      `
      await executeQuery('SAVEPOINT sp_update')
      try {
        await executeQuery(updateSql, [
          idOrContractId,
          outcome.status,
          outcome.balance,
          outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
          incoming.network ?? null,
        ])
        await executeQuery('RELEASE SAVEPOINT sp_update')
      } catch {
        await executeQuery('ROLLBACK TO SAVEPOINT sp_update')
        const fallbackUpdate = `
          UPDATE escrow_transactions
          SET status = $2, balance = $3::numeric, ledger_seq = $4,
              network = COALESCE(escrow_transactions.network, $5),
              updated_at = NOW()
          WHERE id::text = $1 OR contract_id = $1
        `
        await executeQuery(fallbackUpdate, [
          idOrContractId,
          outcome.status,
          outcome.balance,
          outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
          incoming.network ?? null,
        ])
      }
    }

    await executeQuery('COMMIT')
    txOpen = false
    return outcome
  } catch (err) {
    if (txOpen) {
      try {
        await executeQuery('ROLLBACK')
      } catch {
        // ignore rollback error
      }
    }
    throw err
  } finally {
    if (client && !isCustomClient && typeof (client as any).release === 'function') {
      (client as any).release()
    }
  }
}

export const applyEscrowFreshnessUpdate = updateEscrowWithFreshness
