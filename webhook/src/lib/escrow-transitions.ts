'use strict'

import { EscrowStatus, EscrowEventType } from '../types/escrow.types'

export class StateConflictError extends Error {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'StateConflictError'
  }
}

export class StaleStateError extends Error {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'StaleStateError'
  }
}

export interface TransitionRule {
  from: string[]
  to: string
  event: string
  reason?: string
}

export interface EscrowStateMachineBindings {
  validateTransition(from: string, to: string, event: string): boolean
  getValidPriorStates(to: string, event: string): string
  getTransitionTable(): string
  getGraphqlFilter(to: string, event: string): string
}

let _bindings: EscrowStateMachineBindings | null = null
let _bindingsOverride: EscrowStateMachineBindings | null | undefined

function loadBindings(): EscrowStateMachineBindings {
  if (_bindingsOverride !== undefined && _bindingsOverride !== null) {
    return _bindingsOverride
  }
  if (_bindings) return _bindings
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _bindings = require('../../../crates/escrow-state-machine')
    return _bindings!
  } catch (err) {
    throw new Error(
      `Failed to load escrow-state-machine transition engine: ${(err as Error).message}`
    )
  }
}

/**
 * Test seam to inject mock or fake bindings for testing without native binaries.
 */
export function __setEscrowStateMachineBindingsForTests(
  mock: EscrowStateMachineBindings | null | undefined
): void {
  _bindingsOverride = mock
  _bindings = null
}

/**
 * Returns an array of valid prior states for a target status and webhook event.
 * Delegates to the canonical escrow-state-machine.
 */
export function getValidPriorStates(
  to: EscrowStatus | string,
  event: EscrowEventType | string
): string[] {
  const bindings = loadBindings()
  const raw = bindings.getValidPriorStates(String(to), String(event))
  return JSON.parse(raw) as string[]
}

/**
 * Checks whether transitioning from `from` to `to` via `event` is legal.
 */
export function validateTransition(
  from: EscrowStatus | string,
  to: EscrowStatus | string,
  event: EscrowEventType | string
): boolean {
  const bindings = loadBindings()
  return bindings.validateTransition(String(from), String(to), String(event))
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
  const bindings = loadBindings()
  const raw = bindings.getTransitionTable()
  return JSON.parse(raw) as TransitionRule[]
}
