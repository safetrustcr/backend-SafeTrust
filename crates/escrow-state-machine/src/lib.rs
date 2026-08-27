use neon::prelude::*;
use crate::states::{EscrowStatus, WebhookEvent};
use crate::validator::{graphql_in_filter, is_valid_transition, valid_prior_states};

mod states;
mod transitions;
mod validator;

/// Validate a state transition.
///
/// Returns `true` if `from → to` via `event` is a legal SafeTrust transition.
/// Throws a descriptive error on an unknown status or event string.
fn validate_transition(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let from_str  = cx.argument::<JsString>(0)?.value(&mut cx);
    let to_str    = cx.argument::<JsString>(1)?.value(&mut cx);
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
    let to_str    = cx.argument::<JsString>(0)?.value(&mut cx);
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

    let json = match serde_json::to_string(
        &states.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
    ) {
        Ok(value) => value,
        Err(error) => return cx.throw_error(error.to_string()),
    };

    Ok(cx.string(json))
}

/// Returns the complete transition table as JSON for documentation/debugging.
fn get_transition_table(mut cx: FunctionContext) -> JsResult<JsString> {
    let table: Vec<serde_json::Value> = crate::transitions::transition_table()
        .iter()
        .map(|rule| serde_json::json!({
            "from":   rule.from.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            "to":     rule.to.as_str(),
            "event":  rule.event.as_str(),
            "reason": rule.reason,
        }))
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
    let to_str    = cx.argument::<JsString>(0)?.value(&mut cx);
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

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("validateTransition",    validate_transition)?;
    cx.export_function("getValidPriorStates",   get_valid_prior_states)?;
    cx.export_function("getTransitionTable",    get_transition_table)?;
    cx.export_function("getGraphqlFilter",      get_graphql_filter)?;
    Ok(())
}
