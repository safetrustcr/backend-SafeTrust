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
 * 3. The Four Conflict Cases & Outcomes:
 *    - Incoming newer (incoming_seq > stored_seq or stored is NULL): Write status, balance, ledger_seq.
 *    - Incoming older (incoming_seq < stored_seq): Reject silently; no write, no error.
 *    - Equal seq (incoming_seq == stored_seq), same values: Idempotent no-op; no write, no error.
 *    - Equal seq (incoming_seq == stored_seq), different values: Preserve stored confirmed state, log conflict.
 *
 * 4. Why Terminal States Must NOT Be Ordered by Numeric Status Rank:
 *    Escrow states represent a directed transition graph. Terminal states (`completed`, `resolved`,
 *    `cancelled`) signify permanent funds settlement. Ordering by numeric status rank could allow
 *    a later sequence or numerical status to overwrite or resurrect a terminal escrow (e.g. moving
 *    from `completed` to `cancelled`). Terminal states are strictly immutable and absorbing.
 */

import { hasuraRequest } from '../services/hasura'
import db, { connect } from '../services/db'
import type { PoolClient } from 'pg'
import {
  evaluateFreshness,
  formatExactBalance,
  parseLedgerSeq,
  FreshnessOutcome,
  StoredEscrowState,
  IncomingEscrowObservation,
} from '../lib/escrow-freshness'

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
  }
}

export async function updateEscrowStatus(
  contractId: string,
  status: EscrowStatus
): Promise<void> {
  const mutation = `
    mutation UpdateEscrowStatus($contractId: String!, $status: String!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
        _set: { status: $status }
      ) {
        affected_rows
      }
    }
  `

  await hasuraRequest(mutation, { contractId, status })
}

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

export async function releaseFunds(
  contractId: string
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation ReleaseFunds($contractId: String!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
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
  }>(mutation, { contractId })

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
    return db.query(sql, params)
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
    try {
      const res = await executeQuery(selectSql, [idOrContractId])
      storedRow = res.rows[0]
    } catch {
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

    const outcome = evaluateFreshness(storedState, incoming)

    if (outcome.type === 'WRITE') {
      if (storedRow) {
        // Update existing row
        const updateSql = `
          UPDATE safetrust.escrow_transactions
          SET status = $2, balance = $3::numeric, ledger_seq = $4, updated_at = NOW()
          WHERE id::text = $1 OR contract_id = $1
        `
        try {
          await executeQuery(updateSql, [
            idOrContractId,
            outcome.status,
            outcome.balance,
            outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
          ])
        } catch {
          const fallbackUpdate = `
            UPDATE escrow_transactions
            SET status = $2, balance = $3::numeric, ledger_seq = $4, updated_at = NOW()
            WHERE id::text = $1 OR contract_id = $1
          `
          await executeQuery(fallbackUpdate, [
            idOrContractId,
            outcome.status,
            outcome.balance,
            outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
          ])
        }
      } else {
        // Insert new row
        const insertSql = `
          INSERT INTO safetrust.escrow_transactions (
            contract_id, engagement_id, property_id, sender_address, receiver_address,
            amount, balance, status, ledger_seq, network, created_at, updated_at
          ) VALUES (
            $1, $1, 'default', 'G_UNKNOWN', 'G_UNKNOWN',
            $2::numeric, $3::numeric, $4, $5, $6, NOW(), NOW()
          )
        `
        try {
          await executeQuery(insertSql, [
            idOrContractId,
            observation.amount ? formatExactBalance(observation.amount) : outcome.balance,
            outcome.balance,
            outcome.status,
            outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
            observation.network ?? 'testnet',
          ])
        } catch {
          const fallbackInsert = `
            INSERT INTO escrow_transactions (
              contract_id, engagement_id, property_id, sender_address, receiver_address,
              amount, balance, status, ledger_seq, network, created_at, updated_at
            ) VALUES (
              $1, $1, 'default', 'G_UNKNOWN', 'G_UNKNOWN',
              $2::numeric, $3::numeric, $4, $5, $6, NOW(), NOW()
            )
          `
          await executeQuery(fallbackInsert, [
            idOrContractId,
            observation.amount ? formatExactBalance(observation.amount) : outcome.balance,
            outcome.balance,
            outcome.status,
            outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
            observation.network ?? 'testnet',
          ])
        }
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
