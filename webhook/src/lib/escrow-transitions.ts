'use strict'

/**
 * @file webhook/src/lib/escrow-transitions.ts
 * @description The SafeTrust escrow state machine: the one transition table
 * used by the escrow service, the route handlers, the freshness evaluator and
 * the reconciliation UPSERT guard.
 *
 * Every legal transition is listed exactly once in `TRANSITION_TABLE`; any
 * transition that is not in the table is invalid by definition. The table,
 * its order and its reasons are a port of the former Rust crate
 * (`crates/escrow-state-machine/src/transitions.rs`), and the crate's unit
 * tests live on as `lib/__tests__/escrow-state-machine.test.ts`.
 */

import { EscrowStatus, EscrowEventType } from '../types/escrow.types'
import { ConflictError } from '../utils/errors'

export class StateConflictError extends ConflictError {
  constructor(message: string) {
    super(message, { code: 'state_conflict' })
    this.name = 'StateConflictError'
  }
}

export class StaleStateError extends ConflictError {
  constructor(message: string) {
    super(message, { code: 'stale_state' })
    this.name = 'StaleStateError'
  }
}

/** Every escrow status, in declaration order. */
export const ESCROW_STATUSES: readonly EscrowStatus[] = Object.freeze([
  EscrowStatus.Created,
  EscrowStatus.PendingFunding,
  EscrowStatus.Funded,
  EscrowStatus.Active,
  EscrowStatus.MilestoneApproved,
  EscrowStatus.Completed,
  EscrowStatus.Disputed,
  EscrowStatus.Resolved,
  EscrowStatus.Cancelled,
])

/** Every escrow lifecycle event. */
export const ESCROW_EVENTS: readonly EscrowEventType[] = Object.freeze([
  EscrowEventType.Initialized,
  EscrowEventType.Funded,
  EscrowEventType.MilestoneApproved,
  EscrowEventType.FundsReleased,
  EscrowEventType.DisputeOpened,
  EscrowEventType.DisputeResolved,
  EscrowEventType.Cancelled,
])

/** Final settlement states: funds were paid out, split or returned. */
export const TERMINAL_STATUSES: readonly EscrowStatus[] = Object.freeze([
  EscrowStatus.Completed,
  EscrowStatus.Resolved,
  EscrowStatus.Cancelled,
])

/** Unconfirmed states that an unversioned snapshot may still update. */
export const PENDING_STATUSES: readonly EscrowStatus[] = Object.freeze([
  EscrowStatus.Created,
  EscrowStatus.PendingFunding,
])

export interface TransitionRule {
  from: string[]
  to: string
  event: string
  reason?: string
}

interface CanonicalRule {
  readonly from: readonly EscrowStatus[]
  readonly to: EscrowStatus
  readonly event: EscrowEventType
  readonly reason: string
}

const S = EscrowStatus
const E = EscrowEventType

/**
 * The canonical SafeTrust escrow state machine.
 *
 * `pending_funding` (the pre-creation onboarding state) and `active` (reached
 * implicitly when fully funded) have no inbound rule of their own.
 */
const TRANSITION_TABLE: readonly CanonicalRule[] = Object.freeze([
  {
    from: [S.PendingFunding],
    to: S.Created,
    event: E.Initialized,
    reason: 'Escrow deployed on Stellar — awaiting guest funding',
  },
  {
    from: [S.Created, S.PendingFunding],
    to: S.Funded,
    event: E.Funded,
    reason: 'Guest deposited USDC — funds locked in escrow contract',
  },
  {
    from: [S.Funded],
    to: S.Active,
    event: E.Funded,
    reason: 'Escrow fully funded — booking is confirmed and active',
  },
  {
    from: [S.Active, S.Funded],
    to: S.MilestoneApproved,
    event: E.MilestoneApproved,
    reason: 'Host approved milestone (check-in or check-out)',
  },
  {
    from: [S.Funded, S.MilestoneApproved],
    to: S.Completed,
    event: E.FundsReleased,
    reason: 'Funds released to host (single-release or all milestones approved)',
  },
  {
    from: [S.Funded, S.Active, S.MilestoneApproved],
    to: S.Disputed,
    event: E.DisputeOpened,
    reason: 'Guest or host raised a dispute',
  },
  {
    from: [S.Disputed],
    to: S.Resolved,
    event: E.DisputeResolved,
    reason: 'Dispute resolved by arbitrator',
  },
  {
    // A dispute has two legal terminal outcomes: `resolved` (funds split or
    // released) or `cancelled` (funds returned to the tenant). Both values are
    // permitted by the database `valid_escrow_status` CHECK constraint.
    from: [S.Created, S.PendingFunding, S.Funded, S.Disputed],
    to: S.Cancelled,
    event: E.Cancelled,
    reason: 'Booking cancelled, or disputed funds returned to the tenant',
  },
].map((rule) => Object.freeze({ ...rule, from: Object.freeze(rule.from) })))

const STATUS_SET: ReadonlySet<string> = new Set(ESCROW_STATUSES)
const EVENT_SET: ReadonlySet<string> = new Set(ESCROW_EVENTS)

/** Returns true when `value` is one of the nine escrow statuses (exact match). */
export function isEscrowStatus(value: unknown): value is EscrowStatus {
  return typeof value === 'string' && STATUS_SET.has(value)
}

/** Returns true when `value` is one of the seven lifecycle events (exact match). */
export function isEscrowEvent(value: unknown): value is EscrowEventType {
  return typeof value === 'string' && EVENT_SET.has(value)
}

function parseStatus(value: EscrowStatus | string): EscrowStatus {
  const status = String(value)
  if (!isEscrowStatus(status)) throw new Error(`Unknown escrow status: '${status}'`)
  return status
}

function parseEvent(value: EscrowEventType | string): EscrowEventType {
  const event = String(value)
  if (!isEscrowEvent(event)) throw new Error(`Unknown webhook event: '${event}'`)
  return event
}

/** Whether a known status is terminal (completed, resolved, cancelled). */
export function isTerminal(status: EscrowStatus | string): boolean {
  return TERMINAL_STATUSES.includes(parseStatus(status))
}

/**
 * Returns the valid prior states for a target status and lifecycle event, in
 * table order. Used to build the `status IN (...)` guard of a state update.
 *
 * Throws on an unknown status or event, and when no rule reaches `to` via
 * `event` (for example `completed` via `dispute.raised`).
 */
export function getValidPriorStates(
  to: EscrowStatus | string,
  event: EscrowEventType | string
): string[] {
  const target = parseStatus(to)
  const via = parseEvent(event)
  const matching = TRANSITION_TABLE.filter(
    (rule) => rule.to === target && rule.event === via
  ).flatMap((rule) => rule.from)
  if (matching.length === 0) {
    throw new Error(`No valid prior states for transition to ${target} via ${via}`)
  }
  return matching
}

/**
 * Checks whether transitioning from `from` to `to` via `event` is listed in the
 * table. Reaffirming a status (`from === to`) is not a transition here.
 *
 * Throws on an unknown status or event.
 */
export function validateTransition(
  from: EscrowStatus | string,
  to: EscrowStatus | string,
  event: EscrowEventType | string
): boolean {
  const source = parseStatus(from)
  const target = parseStatus(to)
  const via = parseEvent(event)
  return TRANSITION_TABLE.some(
    (rule) => rule.to === target && rule.event === via && rule.from.includes(source)
  )
}

/**
 * Checks whether a status change from `from` to `to` is legal by any event.
 *
 * - Reaffirming the same status is allowed (idempotent write).
 * - A terminal status never changes; in particular `cancelled` is not reachable
 *   from `completed` or `resolved`.
 * - Otherwise the change is legal only if some rule permits `from → to`.
 *
 * Throws on an unknown status.
 */
export function canTransition(from: EscrowStatus | string, to: EscrowStatus | string): boolean {
  const source = parseStatus(from)
  const target = parseStatus(to)
  if (source === target) return true
  if (TERMINAL_STATUSES.includes(source)) return false
  return TRANSITION_TABLE.some((rule) => rule.to === target && rule.from.includes(source))
}

/**
 * Asserts that a state transition is legal. Throws StateConflictError if invalid.
 */
export function assertValidTransition(
  from: EscrowStatus | string,
  to: EscrowStatus | string,
  event: EscrowEventType | string
): void {
  const isValid = validateTransition(from, to, event)
  if (!isValid) {
    throw new StateConflictError(
      `Illegal escrow state transition from '${from}' to '${to}' via '${event}'`
    )
  }
}

/**
 * Returns a copy of the complete canonical transition table.
 */
export function getTransitionTable(): TransitionRule[] {
  return TRANSITION_TABLE.map((rule) => ({
    from: [...rule.from],
    to: rule.to,
    event: rule.event,
    reason: rule.reason,
  }))
}
