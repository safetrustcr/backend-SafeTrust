//! # Escrow State Machine Architecture & State Invariants (Issue #661)
//!
//! ### 1. Why `received_at` is NOT a valid ordering proxy
//! `received_at` is an ingestion timestamp recorded when a server observes an event.
//! Due to network latency, retries, worker thread scheduling, and out-of-order webhook delivery,
//! a later `received_at` timestamp can correspond to an earlier on-chain blockchain event.
//! Basing update decisions on `received_at` leads to severe state regressions (e.g. overwriting
//! `completed` with a delayed `funded` event). The authoritative ordering token is strictly
//! the source `ledger_seq` (ledger sequence number).
//!
//! ### 2. The Unversioned Snapshot Policy
//! When an observation arrives without a `ledger_seq` from the source (an unversioned snapshot):
//! - It is ONLY allowed to update pending records (`created`, `pending_funding`).
//! - It is REJECTED for any confirmed or terminal record (`funded`, `completed`, `resolved`, etc.).
//! - Exact token amounts must be preserved — nonzero stored balances must never be zeroed out
//!   by unversioned snapshots.
//!
//! ### 3. The Four Conflict Cases & Outcomes
//! For stored record sequence $S$ and incoming observation sequence $I$:
//! - **Incoming newer ($I > S$ or $S$ is None):** Write proceeds if state transition is valid
//!   and stored state is not terminal.
//! - **Incoming older ($I < S$):** Rejected silently; no write, no error.
//! - **Equal sequence ($I == S$), same values:** Idempotent no-op; no write, no error.
//! - **Equal sequence ($I == S$), different values:** Stored confirmed state is preserved;
//!   a conflict log entry is emitted.
//!
//! ### 4. Why Terminal States Must NOT Be Ordered by Numeric Status Rank
//! Terminal states (`completed`, `resolved`, `cancelled`) represent final settlement.
//! Once settled, funds have either been disbursed or returned. Ordering states by numeric
//! rank would permit an observation with higher rank or sequence to erroneously overwrite
//! a terminal state or allow illegal transitions (e.g. transitioning `completed` to `cancelled`).
//! In SafeTrust, terminal states are strictly absorbing and terminal state protection is enforced
//! regardless of incoming sequence number.

pub mod states;
pub mod transitions;
pub mod validator;

use crate::states::{EscrowStatus, WebhookEvent};
use crate::validator::{
    can_transition_status, graphql_in_filter, is_valid_transition, valid_prior_states,
};
use neon::prelude::*;

/// Validate a state transition.
///
/// Returns `true` if `from → to` via `event` is a legal SafeTrust transition.
/// Throws a descriptive error on an unknown status or event string.
fn validate_transition(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let from_str = cx.argument::<JsString>(0)?.value(&mut cx);
    let to_str = cx.argument::<JsString>(1)?.value(&mut cx);
    let event_str = cx.argument::<JsString>(2)?.value(&mut cx);

    let from = match EscrowStatus::from_str(&from_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };
    let to = match EscrowStatus::from_str(&to_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };
    let event = match WebhookEvent::from_str(&event_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    Ok(cx.boolean(is_valid_transition(&from, &to, &event)))
}

/// Returns a JSON array of valid prior states for a target status + event.
///
/// Used to generate the Hasura GraphQL `_in: [...]` filter dynamically.
/// Throws when no legal (target, event) transition exists.
fn get_valid_prior_states(mut cx: FunctionContext) -> JsResult<JsString> {
    let to_str = cx.argument::<JsString>(0)?.value(&mut cx);
    let event_str = cx.argument::<JsString>(1)?.value(&mut cx);

    let to = match EscrowStatus::from_str(&to_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };
    let event = match WebhookEvent::from_str(&event_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    let states = match valid_prior_states(&to, &event) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    let json = match serde_json::to_string(&states.iter().map(|s| s.as_str()).collect::<Vec<_>>()) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error.to_string()),
    };

    Ok(cx.string(json))
}

/// Returns the complete transition table as JSON for documentation/debugging.
fn get_transition_table(mut cx: FunctionContext) -> JsResult<JsString> {
    let table: Vec<serde_json::Value> = crate::transitions::transition_table()
        .iter()
        .map(|rule| {
            serde_json::json!({
                "from":   rule.from.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
                "to":     rule.to.as_str(),
                "event":  rule.event.as_str(),
                "reason": rule.reason,
            })
        })
        .collect();

    let json = match serde_json::to_string(&table) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error.to_string()),
    };

    Ok(cx.string(json))
}

/// Returns the GraphQL `_in` filter values for a target status + event.
///
/// Convenience wrapper around `valid_prior_states` that emits a JSON string
/// array of snake_case status strings (the values for `status: { _in: [...] }`).
fn get_graphql_filter(mut cx: FunctionContext) -> JsResult<JsString> {
    let to_str = cx.argument::<JsString>(0)?.value(&mut cx);
    let event_str = cx.argument::<JsString>(1)?.value(&mut cx);

    let to = match EscrowStatus::from_str(&to_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };
    let event = match WebhookEvent::from_str(&event_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    let values = match graphql_in_filter(&to, &event) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    let json = match serde_json::to_string(&values) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error.to_string()),
    };

    Ok(cx.string(json))
}

/// Check if transition from_status -> to_status is legal.
fn can_transition(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let from_str = cx.argument::<JsString>(0)?.value(&mut cx);
    let to_str = cx.argument::<JsString>(1)?.value(&mut cx);

    let from = match EscrowStatus::from_str(&from_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };
    let to = match EscrowStatus::from_str(&to_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    Ok(cx.boolean(can_transition_status(&from, &to)))
}

/// Check if a status string represents a terminal status (completed, resolved, cancelled).
fn is_terminal(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let status_str = cx.argument::<JsString>(0)?.value(&mut cx);

    let status = match EscrowStatus::from_str(&status_str) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error),
    };

    Ok(cx.boolean(status.is_terminal()))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("validateTransition", validate_transition)?;
    cx.export_function("canTransition", can_transition)?;
    cx.export_function("isTerminal", is_terminal)?;
    cx.export_function("getValidPriorStates", get_valid_prior_states)?;
    cx.export_function("getTransitionTable", get_transition_table)?;
    cx.export_function("getGraphqlFilter", get_graphql_filter)?;
    Ok(())
}
