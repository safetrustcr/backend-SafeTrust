use neon::prelude::*;
use crate::states::{EscrowStatus, WebhookEvent};
use crate::transitions::{is_valid_transition, valid_prior_states};

mod states;
mod transitions;

/// Validate a state transition.
/// Returns true if from→to via event is a legal SafeTrust transition.
/// Throws on unknown status or event strings.
fn validate_transition(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let from_str  = cx.argument::<JsString>(0)?.value(&mut cx);
    let to_str    = cx.argument::<JsString>(1)?.value(&mut cx);
    let event_str = cx.argument::<JsString>(2)?.value(&mut cx);

    let from  = EscrowStatus::from_str(&from_str)
        .or_else(|e| cx.throw_error::<_, ()>(e).map(|_| unreachable!()))?;
    let to    = EscrowStatus::from_str(&to_str)
        .or_else(|e| cx.throw_error::<_, ()>(e).map(|_| unreachable!()))?;
    let event = WebhookEvent::from_str(&event_str)
        .or_else(|e| cx.throw_error::<_, ()>(e).map(|_| unreachable!()))?;

    Ok(cx.boolean(is_valid_transition(&from, &to, &event)))
}

/// Returns JSON array of valid prior states for a target status + event.
/// Used to generate the Hasura GraphQL `_in: [...]` filter dynamically.
fn get_valid_prior_states(mut cx: FunctionContext) -> JsResult<JsString> {
    let to_str    = cx.argument::<JsString>(0)?.value(&mut cx);
    let event_str = cx.argument::<JsString>(1)?.value(&mut cx);

    let to    = EscrowStatus::from_str(&to_str)
        .or_else(|e| cx.throw_error::<_, ()>(e).map(|_| unreachable!()))?;
    let event = WebhookEvent::from_str(&event_str)
        .or_else(|e| cx.throw_error::<_, ()>(e).map(|_| unreachable!()))?;

    let states = valid_prior_states(&to, &event)
        .or_else(|e| cx.throw_error::<_, ()>(e).map(|_| unreachable!()))?;

    let json = serde_json::to_string(
        &states.iter().map(|s| s.as_str()).collect::<Vec<_>>()
    )
    .or_else(|e| cx.throw_error::<_, ()>(e.to_string()).map(|_| unreachable!()))?;

    Ok(cx.string(json))
}

/// Returns the complete transition table as JSON for documentation/debugging.
fn get_transition_table(mut cx: FunctionContext) -> JsResult<JsString> {
    use crate::transitions::transition_table;

    let table: Vec<serde_json::Value> = transition_table()
        .iter()
        .map(|rule| serde_json::json!({
            "from":   rule.from.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            "to":     rule.to.as_str(),
            "event":  rule.event.as_str(),
            "reason": rule.reason,
        }))
        .collect();

    let json = serde_json::to_string(&table)
        .or_else(|e| cx.throw_error::<_, ()>(e.to_string()).map(|_| unreachable!()))?;

    Ok(cx.string(json))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("validateTransition",    validate_transition)?;
    cx.export_function("getValidPriorStates",   get_valid_prior_states)?;
    cx.export_function("getTransitionTable",    get_transition_table)?;
    Ok(())
}
