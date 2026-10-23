'use strict'

/**
 * @file webhook/src/lib/escrow-freshness.ts
 * @description State machine validation and atomic freshness evaluation for escrow updates (Issue #661).
 *
 * Architecture & Invariants Documentation:
 * ────────────────────────────────────────
 * 1. Why `received_at` is NOT a valid ordering proxy:
 *    `received_at` is a local ingestion timestamp assigned by the webhook server or reconciler
 *    when an HTTP request is received. Due to variable network latency, HTTP retries, out-of-order
 *    delivery across concurrent processes, and clock skew, an event that occurred earlier on the
 *    Stellar/Soroban blockchain can arrive at the server AFTER an event that occurred later.
 *    Using `received_at` for ordering decisions causes critical regressions where a delayed
 *    observation overwrites a newer confirmed state. The ONLY authoritative ordering token is the
 *    monotonically increasing on-chain ledger sequence (`ledger_seq`).
 *
 * 2. The Unversioned Snapshot Policy:
 *    When an incoming observation lacks a `ledger_seq` (unversioned snapshot):
 *    - It CANNOT prove that it reflects the current state of the blockchain.
 *    - It may ONLY update unconfirmed pending records (`created`, `pending_funding`).
 *    - It is strictly REJECTED for any confirmed or terminal record (`funded`, `active`,
 *      `milestone_approved`, `completed`, `disputed`, `resolved`, `cancelled`).
 *    - Exact token amounts must be preserved — an unversioned snapshot must NEVER zero out
 *      an existing nonzero stored balance.
 *
 * 3. The Four Conflict Cases & Outcomes:
 *    When comparing stored sequence S and incoming sequence I:
 *    a. Incoming newer (I > S or S is NULL):
 *       WRITE: Apply update to status, balance, and ledger_seq, provided the state machine
 *       transition is valid and the stored record is not terminal.
 *    b. Incoming older (I < S):
 *       REJECT SILENTLY: No write, no error. The stored confirmed state is preserved.
 *    c. Equal sequence (I == S), same values:
 *       IDEMPOTENT NO-OP: No write, no error.
 *    d. Equal sequence (I == S), different values:
 *       CONFLICT LOG: Preserve stored confirmed state and emit a conflict log entry.
 *
 * 4. Why Terminal States Must NOT Be Ordered by Numeric Status Rank:
 *    Escrow lifecycles follow strict directed graph transition rules, not a linear numeric rank.
 *    Terminal states (`completed`, `resolved`, `cancelled`) represent final settlement where funds
 *    have been permanently disbursed or refunded. If states were ordered by numeric status rank,
 *    a later observation or erroneous event could resurrect a closed escrow or transition
 *    `completed` into `cancelled`. Once an escrow reaches `completed` or `resolved`, it is strictly
 *    immutable and can never be overwritten regardless of incoming sequence number or rank.
 */

export type EscrowStatus =
  | 'created'
  | 'pending_funding'
  | 'funded'
  | 'active'
  | 'milestone_approved'
  | 'completed'
  | 'disputed'
  | 'resolved'
  | 'cancelled'
  | string

export interface StoredEscrowState {
  id?: string
  contractId: string
  status: string
  balance: string | number
  ledgerSeq?: bigint | number | string | null
  network?: string | null
}

export interface IncomingEscrowObservation {
  id?: string
  contractId: string
  status: string
  balance: string | number
  amount?: string | number
  ledgerSeq?: bigint | number | string | null
  network?: string | null
}

export type FreshnessOutcome =
  | { type: 'WRITE'; status: string; balance: string; ledgerSeq: bigint | null }
  | { type: 'REJECT_STALE'; reason: string }
  | { type: 'IDEMPOTENT_UNCHANGED' }
  | { type: 'CONFLICT_LOG'; reason: string }
  | { type: 'REJECT_TERMINAL'; reason: string }
  | { type: 'REJECT_UNVERSIONED_FOR_CONFIRMED'; reason: string }
  | { type: 'REJECT_INVALID_TRANSITION'; reason: string }
  | { type: 'REJECT_NETWORK_MISMATCH'; reason: string }

/**
 * Returns true if the status is terminal (completed, resolved, cancelled).
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  if (!status) return false
  const s = status.trim().toLowerCase()
  return s === 'completed' || s === 'resolved' || s === 'cancelled'
}

/**
 * Returns true if the status represents an unconfirmed/pending record.
 */
export function isPendingStatus(status: string | null | undefined): boolean {
  if (!status) return false
  const s = status.trim().toLowerCase()
  return s === 'created' || s === 'pending_funding'
}

let nativeStateMachine: any = null
try {
  nativeStateMachine = require('../../../../crates/escrow-state-machine')
} catch {
  // Addon not available, using canonical TS table
}

/**
 * Canonical transition table defining all legal target statuses reachable from
 * each source status, matching crates/escrow-state-machine/src/transitions.rs.
 */
export const CANONICAL_TRANSITIONS: Record<string, readonly string[]> = {
  created: ['funded', 'cancelled'],
  pending_funding: ['created', 'funded', 'cancelled'],
  funded: ['active', 'milestone_approved', 'disputed', 'cancelled'],
  active: ['milestone_approved', 'disputed'],
  milestone_approved: ['completed', 'disputed'],
  disputed: ['resolved', 'cancelled'],
  completed: [],
  resolved: [],
  cancelled: [],
} as const

/**
 * Validates whether transitioning from `fromStatus` to `toStatus` is legal
 * according to SafeTrust state machine rules.
 */
export function canTransitionStatus(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined
): boolean {
  if (!toStatus) return false
  const to = toStatus.trim().toLowerCase()
  if (!fromStatus) {
    // Initial status insertion
    return to === 'created' || to === 'pending_funding' || to === 'funded'
  }
  const from = fromStatus.trim().toLowerCase()

  // Terminal states cannot transition to any other status
  if (isTerminalStatus(from)) {
    return from === to
  }

  // Same status is always valid (idempotent)
  if (from === to) return true

  // Delegate to native state machine if loaded
  if (nativeStateMachine && typeof nativeStateMachine.canTransition === 'function') {
    try {
      return nativeStateMachine.canTransition(from, to)
    } catch {
      // Fall through to canonical table
    }
  }

  const allowed = CANONICAL_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

/**
 * Format balance as exact string with standard decimal representation,
 * preserving all digits without floating-point precision loss.
 */
export function formatExactBalance(val: string | number | bigint | null | undefined): string {
  if (val === null || val === undefined) return '0.0000000'
  const raw = String(val).trim()
  if (raw === '') return '0.0000000'
  const parts = raw.split('.')
  const intPart = parts[0].replace(/^(-?)0+(?=\d)/, '$1') || '0'
  let fracPart = parts[1] ?? '0'
  if (fracPart.length < 7) {
    fracPart = fracPart.padEnd(7, '0')
  }
  return `${intPart}.${fracPart}`
}

export function isZeroBalance(val: string | number | bigint | null | undefined): boolean {
  if (val === null || val === undefined) return true
  const s = String(val).trim()
  if (s === '' || s === '0' || s === '0.0' || s === '0.0000000') return true
  const n = parseFloat(s)
  return !isNaN(n) && n === 0
}

export function isNonzeroBalance(val: string | number | bigint | null | undefined): boolean {
  return !isZeroBalance(val)
}

export function balancesEqual(
  a: string | number | bigint | null | undefined,
  b: string | number | bigint | null | undefined
): boolean {
  return formatExactBalance(a) === formatExactBalance(b)
}

/**
 * Parse a ledger sequence into a BigInt, or null if absent/invalid.
 */
export function parseLedgerSeq(val: bigint | number | string | null | undefined): bigint | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'bigint') return val
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || Math.floor(val) !== val) return null
    return BigInt(val)
  }
  const trimmed = String(val).trim()
  if (trimmed === '') return null
  try {
    return BigInt(trimmed)
  } catch {
    return null
  }
}

/**
 * Core freshness evaluation logic applied in both pg-bulk-upsert (Rust)
 * and TypeScript paths (reconciliation, repository).
 */
export function evaluateFreshness(
  stored: StoredEscrowState | null | undefined,
  incoming: IncomingEscrowObservation
): FreshnessOutcome {
  const incomingStatusNorm = incoming.status.trim().toLowerCase()
  const incomingSeq = parseLedgerSeq(incoming.ledgerSeq)
  const incomingBalanceFormatted = formatExactBalance(incoming.balance)

  // Case 0: New record (no stored row yet)
  if (!stored) {
    return {
      type: 'WRITE',
      status: incomingStatusNorm,
      balance: incomingBalanceFormatted,
      ledgerSeq: incomingSeq,
    }
  }

  const storedStatusNorm = stored.status.trim().toLowerCase()
  const storedSeq = parseLedgerSeq(stored.ledgerSeq)
  const storedBalanceFormatted = formatExactBalance(stored.balance)

  // 1. Network and contract identity validation:
  // A testnet observation must never update a mainnet record.
  if (stored.network && incoming.network) {
    const sNet = stored.network.trim().replace(/^stellar:/i, '').toLowerCase()
    const iNet = incoming.network.trim().replace(/^stellar:/i, '').toLowerCase()
    if (sNet && iNet && sNet !== iNet) {
      return {
        type: 'REJECT_NETWORK_MISMATCH',
        reason: `Network mismatch: stored=${stored.network}, incoming=${incoming.network}`,
      }
    }
  }

  // 2. Terminal state protection:
  // Terminal states (completed, resolved) must NEVER be overwritten regardless of sequence.
  // cancelled is not reachable from completed.
  if (isTerminalStatus(storedStatusNorm)) {
    if (storedStatusNorm === incomingStatusNorm) {
      if (balancesEqual(storedBalanceFormatted, incomingBalanceFormatted)) {
        return { type: 'IDEMPOTENT_UNCHANGED' }
      }
      return {
        type: 'REJECT_TERMINAL',
        reason: `Cannot alter balance of terminal escrow in state '${storedStatusNorm}'`,
      }
    }
    return {
      type: 'REJECT_TERMINAL',
      reason: `Terminal escrow in state '${storedStatusNorm}' cannot be transitioned to '${incomingStatusNorm}'`,
    }
  }

  // 3. Unversioned snapshot policy:
  // When source provides no ledger_seq:
  // - Write ONLY to pending records (created, pending_funding)
  // - Never write to confirmed records (funded, active, milestone_approved, completed, resolved, cancelled)
  // - Nonzero stored balances must not be zeroed out
  if (incomingSeq === null) {
    if (!isPendingStatus(storedStatusNorm)) {
      return {
        type: 'REJECT_UNVERSIONED_FOR_CONFIRMED',
        reason: `Unversioned snapshot rejected for confirmed record in state '${storedStatusNorm}'`,
      }
    }

    if (!canTransitionStatus(storedStatusNorm, incomingStatusNorm)) {
      return {
        type: 'REJECT_INVALID_TRANSITION',
        reason: `Invalid transition from '${storedStatusNorm}' to '${incomingStatusNorm}'`,
      }
    }

    const finalBalance =
      isNonzeroBalance(storedBalanceFormatted) && isZeroBalance(incomingBalanceFormatted)
        ? storedBalanceFormatted
        : incomingBalanceFormatted

    return {
      type: 'WRITE',
      status: incomingStatusNorm,
      balance: finalBalance,
      ledgerSeq: storedSeq, // retain existing sequence
    }
  }

  // 4. Versioned conflict cases (storedSeq vs incomingSeq):
  if (storedSeq === null || incomingSeq > storedSeq) {
    // Case A: Incoming newer -> Write
    if (!canTransitionStatus(storedStatusNorm, incomingStatusNorm)) {
      return {
        type: 'REJECT_INVALID_TRANSITION',
        reason: `Invalid state transition from '${storedStatusNorm}' to '${incomingStatusNorm}'`,
      }
    }

    return {
      type: 'WRITE',
      status: incomingStatusNorm,
      balance: incomingBalanceFormatted,
      ledgerSeq: incomingSeq,
    }
  }

  if (incomingSeq < storedSeq) {
    // Case B: Incoming older -> Reject silently, no write, no error
    return {
      type: 'REJECT_STALE',
      reason: `Incoming seq ${incomingSeq} < stored seq ${storedSeq}`,
    }
  }

  // Case C & D: Equal sequence (incomingSeq === storedSeq)
  const statusSame = storedStatusNorm === incomingStatusNorm
  const balanceSame = balancesEqual(storedBalanceFormatted, incomingBalanceFormatted)

  if (statusSame && balanceSame) {
    // Case C: Same values -> Idempotent no-op
    return { type: 'IDEMPOTENT_UNCHANGED' }
  }

  // Case D: Different values -> Conflict log entry, preserve stored confirmed state
  const reason = `Equal sequence conflict at ledger ${incomingSeq}: stored=(status=${storedStatusNorm}, bal=${storedBalanceFormatted}) vs incoming=(status=${incomingStatusNorm}, bal=${incomingBalanceFormatted})`
  console.warn(`[escrow-freshness] ⚠️  ${reason}`)
  return {
    type: 'CONFLICT_LOG',
    reason,
  }
}
