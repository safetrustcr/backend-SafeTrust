'use strict'

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

export interface TransitionRule {
  from: string[]
  to: string
  event: string
  reason?: string
}

const TRANSITION_TABLE: TransitionRule[] = [
  { from: ['pending_funding'], to: 'created', event: 'escrow.initialized', reason: 'Escrow deployed on Stellar — awaiting guest funding' },
  { from: ['created', 'pending_funding'], to: 'funded', event: 'escrow.funded', reason: 'Guest deposited USDC — funds locked in escrow contract' },
  { from: ['funded'], to: 'active', event: 'escrow.funded', reason: 'Escrow fully funded — booking is confirmed and active' },
  { from: ['active', 'funded'], to: 'milestone_approved', event: 'milestone.approved', reason: 'Host approved milestone (check-in or check-out)' },
  { from: ['funded', 'milestone_approved'], to: 'completed', event: 'funds.released', reason: 'Funds released to host (single-release or all milestones approved)' },
  { from: ['funded', 'active', 'milestone_approved'], to: 'disputed', event: 'dispute.raised', reason: 'Guest or host raised a dispute' },
  { from: ['disputed'], to: 'resolved', event: 'dispute.resolved', reason: 'Dispute resolved by arbitrator' },
  { from: ['created', 'pending_funding', 'funded', 'disputed'], to: 'cancelled', event: 'escrow.cancelled', reason: 'Booking cancelled, or disputed funds returned to the tenant' },
]

/**
 * Returns an array of valid prior states for a target status and webhook event.
 * Delegates to the canonical escrow-state-machine.
 */
export function getValidPriorStates(
  to: EscrowStatus | string,
  event: EscrowEventType | string
): string[] {
  const rule = TRANSITION_TABLE.find((candidate) => candidate.to === String(to) && candidate.event === String(event))
  if (!rule) throw new Error(`No valid prior states for ${String(to)} via ${String(event)}`)
  return [...rule.from]
}

/**
 * Checks whether transitioning from `from` to `to` via `event` is legal.
 */
export function validateTransition(
  from: EscrowStatus | string,
  to: EscrowStatus | string,
  event: EscrowEventType | string
): boolean {
  return TRANSITION_TABLE.some(
    (rule) => rule.to === String(to) && rule.event === String(event) && rule.from.includes(String(from))
  )
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
 * Returns the complete canonical transition table.
 */
export function getTransitionTable(): TransitionRule[] {
  return TRANSITION_TABLE.map((rule) => ({ ...rule, from: [...rule.from] }))
}
