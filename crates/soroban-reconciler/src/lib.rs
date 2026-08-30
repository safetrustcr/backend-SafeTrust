pub mod reconciler;
pub mod rpc_client;
pub mod types;

use neon::prelude::*;
use reconciler::reconcile_escrow;
use rpc_client::query_escrow_state;
use types::{DbEscrowState, SorobanEscrowState};

fn string_argument(cx: &mut FunctionContext, index: i32) -> Option<String> {
    let value = cx.argument_opt(index)?;
    let js_string = value.downcast::<JsString, _>(cx).ok()?;
    Some(js_string.value(cx))
}

fn query_escrow_state_batch(mut cx: FunctionContext) -> JsResult<JsString> {
    let contract_id = match string_argument(&mut cx, 0) {
        Some(id) => id,
        None => return cx.throw_error("Missing contractId argument"),
    };
    let network = string_argument(&mut cx, 1).unwrap_or_else(|| "testnet".to_string());

    match query_escrow_state(&contract_id, &network) {
        Ok(state) => match serde_json::to_string(&state) {
            Ok(json_str) => Ok(cx.string(json_str)),
            Err(err) => cx.throw_error(format!("Failed to serialize escrow state: {}", err)),
        },
        Err(err) => cx.throw_error(err),
    }
}

fn reconcile_batch(mut cx: FunctionContext) -> JsResult<JsString> {
    let on_chain_json = match string_argument(&mut cx, 0) {
        Some(json) => json,
        None => return cx.throw_error("Missing onChainJson argument"),
    };
    let db_state_json = match string_argument(&mut cx, 1) {
        Some(json) => json,
        None => return cx.throw_error("Missing dbStateJson argument"),
    };

    let on_chain: SorobanEscrowState = match serde_json::from_str(&on_chain_json) {
        Ok(state) => state,
        Err(err) => return cx.throw_error(format!("Invalid onChain JSON: {}", err)),
    };

    let db_state: DbEscrowState = match serde_json::from_str(&db_state_json) {
        Ok(state) => state,
        Err(err) => return cx.throw_error(format!("Invalid dbState JSON: {}", err)),
    };

    let report = reconcile_escrow(&on_chain, &db_state);

    match serde_json::to_string(&report) {
        Ok(json_str) => Ok(cx.string(json_str)),
        Err(err) => cx.throw_error(format!("Failed to serialize report: {}", err)),
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("queryEscrowStateBatch", query_escrow_state_batch)?;
    cx.export_function("reconcileBatch", reconcile_batch)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reconcile_in_sync() {
        let on_chain = SorobanEscrowState {
            contract_id: "contract_123".to_string(),
            status: "RELEASED".to_string(),
            balance: 1000000000, // 100 XLM in Stroops
            marker: Some("marker_a".to_string()),
            approver: Some("approver_b".to_string()),
        };

        let db = DbEscrowState {
            contract_id: "contract_123".to_string(),
            id: "db_123".to_string(),
            status: "RELEASED".to_string(),
            balance: 100.0,
            marker: "marker_a".to_string(),
            approver: "approver_b".to_string(),
        };

        let report = reconcile_escrow(&on_chain, &db);
        assert!(report.in_sync);
        assert!(report.discrepancies.is_empty());
    }

    #[test]
    fn test_reconcile_critical_status_and_balance_drift() {
        let on_chain = SorobanEscrowState {
            contract_id: "contract_123".to_string(),
            status: "RESOLVED".to_string(),
            balance: 500000000, // 50 XLM in Stroops
            marker: Some("marker_a".to_string()),
            approver: Some("approver_b".to_string()),
        };

        let db = DbEscrowState {
            contract_id: "contract_123".to_string(),
            id: "db_123".to_string(),
            status: "FUNDED".to_string(),
            balance: 100.0,
            marker: "marker_a".to_string(),
            approver: "approver_b".to_string(),
        };

        let report = reconcile_escrow(&on_chain, &db);
        assert!(!report.in_sync);
        assert_eq!(report.discrepancies.len(), 2);

        let critical: Vec<_> = report
            .discrepancies
            .iter()
            .filter(|d| d.severity == "critical")
            .collect();
        assert_eq!(critical.len(), 2);
    }

    #[test]
    fn test_reconcile_warning_marker_drift() {
        let on_chain = SorobanEscrowState {
            contract_id: "contract_123".to_string(),
            status: "ACTIVE".to_string(),
            balance: 1000000000,
            marker: Some("marker_new".to_string()),
            approver: Some("approver_b".to_string()),
        };

        let db = DbEscrowState {
            contract_id: "contract_123".to_string(),
            id: "db_123".to_string(),
            status: "ACTIVE".to_string(),
            balance: 100.0,
            marker: "marker_old".to_string(),
            approver: "approver_b".to_string(),
        };

        let report = reconcile_escrow(&on_chain, &db);
        assert!(!report.in_sync);
        assert_eq!(report.discrepancies.len(), 1);
        assert_eq!(report.discrepancies[0].severity, "warning");
        assert_eq!(report.discrepancies[0].field, "marker");
    }

    #[test]
    fn test_query_escrow_state_mock() {
        let res = query_escrow_state("mock_contract_1", "testnet");
        assert!(res.is_ok());
        let state = res.unwrap();
        assert_eq!(state.contract_id, "mock_contract_1");
        assert_eq!(state.balance, 1000000000);
    }
}
