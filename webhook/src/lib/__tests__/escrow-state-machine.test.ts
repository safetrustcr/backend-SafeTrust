/**
 * The escrow state machine, ported from the Rust `crates/escrow-state-machine`.
 *
 * 1. "Rust unit tests" is a one-to-one port of the crate's `#[cfg(test)]`
 *    module (validator.rs).
 * 2. "Parity with the Rust table" compares against output captured from the
 *    crate before it was deleted: its `getTransitionTable()` JSON, and every
 *    (from, to[, event]) pair that its `can_transition_status`,
 *    `is_valid_transition` and `valid_prior_states` accepted.
 * 3. "Former addon contract" keeps the checks the webhook ran against the
 *    Neon addon (error messages on unknown input, the `funded` priors).
 */

import {
  ESCROW_EVENTS,
  ESCROW_STATUSES,
  canTransition,
  getTransitionTable,
  getValidPriorStates,
  isTerminal,
  validateTransition,
} from '../escrow-transitions'
import { CANONICAL_TRANSITIONS } from '../escrow-freshness'
import { EscrowEventType as E, EscrowStatus as S } from '../../types/escrow.types'

// ── Captured from the Rust crate (cargo test, before deletion) ──────────────

const RUST_TRANSITION_TABLE = [
  { event: 'escrow.initialized', from: ['pending_funding'], reason: 'Escrow deployed on Stellar — awaiting guest funding', to: 'created' },
  { event: 'escrow.funded', from: ['created', 'pending_funding'], reason: 'Guest deposited USDC — funds locked in escrow contract', to: 'funded' },
  { event: 'escrow.funded', from: ['funded'], reason: 'Escrow fully funded — booking is confirmed and active', to: 'active' },
  { event: 'milestone.approved', from: ['active', 'funded'], reason: 'Host approved milestone (check-in or check-out)', to: 'milestone_approved' },
  { event: 'funds.released', from: ['funded', 'milestone_approved'], reason: 'Funds released to host (single-release or all milestones approved)', to: 'completed' },
  { event: 'dispute.raised', from: ['funded', 'active', 'milestone_approved'], reason: 'Guest or host raised a dispute', to: 'disputed' },
  { event: 'dispute.resolved', from: ['disputed'], reason: 'Dispute resolved by arbitrator', to: 'resolved' },
  { event: 'escrow.cancelled', from: ['created', 'pending_funding', 'funded', 'disputed'], reason: 'Booking cancelled, or disputed funds returned to the tenant', to: 'cancelled' },
]

/** Every `from>to` pair for which Rust `can_transition_status` returned true. */
const RUST_CAN_TRANSITION = [
  'created>created', 'created>funded', 'created>cancelled',
  'pending_funding>created', 'pending_funding>pending_funding', 'pending_funding>funded', 'pending_funding>cancelled',
  'funded>funded', 'funded>active', 'funded>milestone_approved', 'funded>completed', 'funded>disputed', 'funded>cancelled',
  'active>active', 'active>milestone_approved', 'active>disputed',
  'milestone_approved>milestone_approved', 'milestone_approved>completed', 'milestone_approved>disputed',
  'completed>completed',
  'disputed>disputed', 'disputed>resolved', 'disputed>cancelled',
  'resolved>resolved',
  'cancelled>cancelled',
]

/** Every `from>to@event` triple for which Rust `is_valid_transition` returned true. */
const RUST_VALID_TRANSITIONS = [
  'created>funded@escrow.funded', 'created>cancelled@escrow.cancelled',
  'pending_funding>created@escrow.initialized', 'pending_funding>funded@escrow.funded', 'pending_funding>cancelled@escrow.cancelled',
  'funded>active@escrow.funded', 'funded>milestone_approved@milestone.approved', 'funded>completed@funds.released',
  'funded>disputed@dispute.raised', 'funded>cancelled@escrow.cancelled',
  'active>milestone_approved@milestone.approved', 'active>disputed@dispute.raised',
  'milestone_approved>completed@funds.released', 'milestone_approved>disputed@dispute.raised',
  'disputed>resolved@dispute.resolved', 'disputed>cancelled@escrow.cancelled',
]

/** Every `to@event` for which Rust `valid_prior_states` returned Ok, with its value. */
const RUST_PRIOR_STATES: Record<string, string[]> = {
  'active@escrow.funded': ['funded'],
  'cancelled@escrow.cancelled': ['created', 'pending_funding', 'funded', 'disputed'],
  'completed@funds.released': ['funded', 'milestone_approved'],
  'created@escrow.initialized': ['pending_funding'],
  'disputed@dispute.raised': ['funded', 'active', 'milestone_approved'],
  'funded@escrow.funded': ['created', 'pending_funding'],
  'milestone_approved@milestone.approved': ['active', 'funded'],
  'resolved@dispute.resolved': ['disputed'],
}

const sortKeys = (rule: object) =>
  Object.fromEntries(Object.entries(rule).sort(([a], [b]) => a.localeCompare(b)))

describe('escrow state machine — Rust unit tests (validator.rs)', () => {
  it('valid_transitions_are_recognized', () => {
    expect(validateTransition(S.Created, S.Funded, E.Funded)).toBe(true)
    expect(validateTransition(S.PendingFunding, S.Funded, E.Funded)).toBe(true)
    expect(validateTransition(S.Funded, S.Active, E.Funded)).toBe(true)
    expect(validateTransition(S.Funded, S.MilestoneApproved, E.MilestoneApproved)).toBe(true)
    expect(validateTransition(S.MilestoneApproved, S.Completed, E.FundsReleased)).toBe(true)
    expect(validateTransition(S.Funded, S.Completed, E.FundsReleased)).toBe(true)
    expect(validateTransition(S.Funded, S.Disputed, E.DisputeOpened)).toBe(true)
    expect(validateTransition(S.Disputed, S.Resolved, E.DisputeResolved)).toBe(true)
    // A dispute may end with funds returned to the tenant.
    expect(validateTransition(S.Disputed, S.Cancelled, E.Cancelled)).toBe(true)
  })

  it('illegal_transitions_are_rejected', () => {
    // completed → created is not a legal transition
    expect(validateTransition(S.Completed, S.Created, E.Initialized)).toBe(false)
    // created → completed is not a direct transition
    expect(validateTransition(S.Created, S.Completed, E.FundsReleased)).toBe(false)
    // wrong event
    expect(validateTransition(S.Funded, S.Active, E.Initialized)).toBe(false)
    // a completed escrow cannot be cancelled
    expect(validateTransition(S.Completed, S.Cancelled, E.Cancelled)).toBe(false)
  })

  it('funded_prior_states_match_spec', () => {
    expect(getValidPriorStates(S.Funded, E.Funded)).toEqual(['created', 'pending_funding'])
  })

  it('unknown_target_event_pair_errors', () => {
    expect(() => getValidPriorStates(S.Completed, E.DisputeOpened)).toThrow()
  })

  it('table_covers_every_status_as_a_target', () => {
    const targets = getTransitionTable().map((rule) => rule.to)
    for (const status of ESCROW_STATUSES) {
      // These variants have no inbound transitions by design.
      if (status === S.PendingFunding || status === S.Active) continue
      expect(targets).toContain(status)
    }
  })

  it('terminal_states_cannot_transition_to_any_other_state', () => {
    for (const terminal of [S.Completed, S.Resolved, S.Cancelled]) {
      for (const other of ESCROW_STATUSES) {
        if (other !== terminal) {
          expect({ terminal, other, legal: canTransition(terminal, other) }).toEqual({
            terminal,
            other,
            legal: false,
          })
        }
      }
    }
  })

  it('completed_cannot_be_cancelled', () => {
    expect(canTransition(S.Completed, S.Cancelled)).toBe(false)
    expect(canTransition(S.Resolved, S.Cancelled)).toBe(false)
  })

  it('can_transition_status_valid_lifecycle', () => {
    expect(canTransition(S.Created, S.Funded)).toBe(true)
    expect(canTransition(S.Funded, S.Active)).toBe(true)
    expect(canTransition(S.Funded, S.Completed)).toBe(true)
    expect(canTransition(S.Active, S.MilestoneApproved)).toBe(true)
    expect(canTransition(S.MilestoneApproved, S.Completed)).toBe(true)
    expect(canTransition(S.Funded, S.Disputed)).toBe(true)
    expect(canTransition(S.Disputed, S.Resolved)).toBe(true)
    expect(canTransition(S.Disputed, S.Cancelled)).toBe(true)
    expect(canTransition(S.Created, S.Cancelled)).toBe(true)
    // Idempotent reaffirmation
    expect(canTransition(S.Funded, S.Funded)).toBe(true)
  })
})

describe('escrow state machine — parity with the Rust table', () => {
  it('has the same rules, in the same order, with the same reasons', () => {
    expect(getTransitionTable().map(sortKeys)).toEqual(RUST_TRANSITION_TABLE)
  })

  it('accepts exactly the status changes the Rust can_transition_status accepted', () => {
    const accepted = ESCROW_STATUSES.flatMap((from) =>
      ESCROW_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`)
    )
    expect(accepted).toEqual(RUST_CAN_TRANSITION)
  })

  it('accepts exactly the transitions the Rust is_valid_transition accepted', () => {
    const accepted = ESCROW_STATUSES.flatMap((from) =>
      ESCROW_STATUSES.flatMap((to) =>
        ESCROW_EVENTS.filter((event) => validateTransition(from, to, event)).map(
          (event) => `${from}>${to}@${event}`
        )
      )
    )
    expect(accepted).toEqual(RUST_VALID_TRANSITIONS)
  })

  it('returns the Rust valid_prior_states for every (target, event), and throws for the rest', () => {
    const priors: Record<string, string[]> = {}
    for (const to of ESCROW_STATUSES) {
      for (const event of ESCROW_EVENTS) {
        const key = `${to}@${event}`
        if (key in RUST_PRIOR_STATES) {
          priors[key] = getValidPriorStates(to, event)
        } else {
          expect(() => getValidPriorStates(to, event)).toThrow(/No valid prior states/)
        }
      }
    }
    expect(priors).toEqual(RUST_PRIOR_STATES)
  })

  it('derives CANONICAL_TRANSITIONS (freshness + reconciliation SQL) from the same table', () => {
    const fromTable = Object.entries(CANONICAL_TRANSITIONS).flatMap(([from, targets]) =>
      targets.map((to) => `${from}>${to}`)
    )
    const rustWithoutReaffirm = RUST_CAN_TRANSITION.filter((pair) => {
      const [from, to] = pair.split('>')
      return from !== to
    })
    expect(fromTable).toEqual(rustWithoutReaffirm)
    expect(Object.keys(CANONICAL_TRANSITIONS)).toEqual([...ESCROW_STATUSES])
  })

  it('treats exactly completed, resolved and cancelled as terminal', () => {
    expect(ESCROW_STATUSES.filter((status) => isTerminal(status))).toEqual([
      'completed',
      'resolved',
      'cancelled',
    ])
  })
})

describe('escrow state machine — former addon contract', () => {
  it('validateTransition throws on an unknown status', () => {
    expect(() => validateTransition('unknown_status', 'funded', 'escrow.funded')).toThrow(
      /Unknown escrow status/
    )
    expect(() => validateTransition('created', 'FUNDED', 'escrow.funded')).toThrow(
      /Unknown escrow status/
    )
  })

  it('validateTransition throws on an unknown event', () => {
    expect(() => validateTransition('created', 'funded', 'escrow.paid')).toThrow(
      /Unknown webhook event/
    )
  })

  it('getValidPriorStates throws when no legal transition exists', () => {
    expect(() => getValidPriorStates('completed', 'dispute.raised')).toThrow(
      /No valid prior states/
    )
  })

  it('allows a disputed escrow to be cancelled', () => {
    expect(validateTransition('disputed', 'cancelled', 'escrow.cancelled')).toBe(true)
    expect(getValidPriorStates('cancelled', 'escrow.cancelled')).toContain('disputed')
  })

  it('getTransitionTable returns a copy that callers cannot use to change the table', () => {
    const table = getTransitionTable()
    expect(table).toHaveLength(8)
    table[1].from.push('completed')
    expect(getValidPriorStates('funded', 'escrow.funded')).toEqual(['created', 'pending_funding'])
  })
})
