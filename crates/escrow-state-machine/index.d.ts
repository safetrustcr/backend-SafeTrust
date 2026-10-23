/// Validate a SafeTrust escrow state transition.
/// Returns true if `from → to` via `event` is a legal transition.
export function validateTransition(
  from: string,
  to: string,
  event: string
): boolean

/// Returns the valid prior states (JSON array of snake_case status strings)
/// for a target status + event. Used to drive the Hasura GraphQL `_in` filter.
/// Throws if no legal transition exists for the (target, event) pair.
export function getValidPriorStates(
  to: string,
  event: string
): string

/// Returns the complete SafeTrust transition table as a JSON string.
export function getTransitionTable(): string
