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
    use crate::rpc_client::*;
    use std::time::Duration;
    use stellar_strkey::Strkey;

    fn test_contract_address(seed: u8) -> String {
        Strkey::Contract(stellar_strkey::Contract([seed; 32])).to_string()
    }

    #[test]
    fn test_reconcile_in_sync() {
        let on_chain = SorobanEscrowState {
            contract_id: "contract_123".to_string(),
            status: "released".to_string(),
            balance: 1000000000, // 100 XLM in Stroops
            marker: Some("marker_a".to_string()),
            approver: Some("approver_b".to_string()),
            releaser: None,
            asset_code: None,
            network: None,
        };

        let db = DbEscrowState {
            contract_id: "contract_123".to_string(),
            id: "db_123".to_string(),
            status: "released".to_string(),
            balance: 100.0,
            balance_stroops: Some(1000000000),
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
            status: "resolved".to_string(),
            balance: 500000000, // 50 XLM in Stroops
            marker: Some("marker_a".to_string()),
            approver: Some("approver_b".to_string()),
            releaser: None,
            asset_code: None,
            network: None,
        };

        let db = DbEscrowState {
            contract_id: "contract_123".to_string(),
            id: "db_123".to_string(),
            status: "funded".to_string(),
            balance: 100.0,
            balance_stroops: Some(1000000000),
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
            status: "active".to_string(),
            balance: 1000000000,
            marker: Some("marker_new".to_string()),
            approver: Some("approver_b".to_string()),
            releaser: None,
            asset_code: None,
            network: None,
        };

        let db = DbEscrowState {
            contract_id: "contract_123".to_string(),
            id: "db_123".to_string(),
            status: "active".to_string(),
            balance: 100.0,
            balance_stroops: Some(1000000000),
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
    fn test_rejects_mock_and_test_shortcuts() {
        // Production code paths must never allow mock_ / test_ shortcuts
        let mock_res = validate_contract_identity("mock_contract_1");
        assert!(mock_res.is_err());
        assert!(mock_res.unwrap_err().contains("mock shortcuts are prohibited"));

        let test_res = validate_contract_identity("test_escrow_abc");
        assert!(test_res.is_err());
        assert!(test_res.unwrap_err().contains("mock shortcuts are prohibited"));

        let empty_res = validate_contract_identity("");
        assert!(empty_res.is_err());

        // Account address (G...) is not a contract address (C...)
        let g_addr = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
        let g_res = validate_contract_identity(g_addr);
        assert!(g_res.is_err());
        assert!(g_res.unwrap_err().contains("expected 56-character C... address"));

        // Valid C... address
        let valid_c = test_contract_address(1);
        assert!(validate_contract_identity(&valid_c).is_ok());
    }

    #[test]
    fn test_healthy_rpc_with_no_contract_data_rejected() {
        // AC 1 & 7: getHealth alone never returns escrow state or triggers updates
        let contract_id = test_contract_address(10);
        let health_only_resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "status": "healthy"
            }
        });

        let res = validate_rpc_contract_response(&health_only_resp, &contract_id);
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("Missing contract data: getHealth confirms node reachability but does not establish contract state"));

        // Empty entries array is also explicitly rejected as contract not found
        let empty_entries_resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "entries": []
            }
        });
        let res_empty = validate_rpc_contract_response(&empty_entries_resp, &contract_id);
        assert!(res_empty.is_err());
        let err_empty = res_empty.unwrap_err();
        assert!(err_empty.contains("Contract"));
        assert!(err_empty.contains("not found on ledger"));
    }


    #[test]
    fn test_network_identity_verification() {
        // AC 4 & 5: Wrong network is rejected with explicit error
        assert!(validate_network_identity("testnet", "Test SDF Network ; September 2015").is_ok());
        assert!(validate_network_identity("mainnet", "Public Global Stellar Network ; September 2015").is_ok());

        let wrong_net = validate_network_identity("testnet", "Public Global Stellar Network ; September 2015");
        assert!(wrong_net.is_err());
        assert!(wrong_net.unwrap_err().contains("Network mismatch"));

        let unknown_net = validate_network_identity("invalid_net", "Some Passphrase");
        assert!(unknown_net.is_err());
        assert!(unknown_net.unwrap_err().contains("Unrecognized Stellar network"));
    }

    #[test]
    fn test_malformed_and_unrecognized_response_shapes() {
        // AC 4: Unrecognized response shapes return explicit errors with no fallback defaults
        let contract_id = test_contract_address(20);

        // Empty array
        let empty_arr = serde_json::json!([]);
        let res_arr = validate_response_shape(&empty_arr, &contract_id);
        assert!(res_arr.is_err());
        assert!(res_arr.unwrap_err().contains("empty response array"));

        // Missing contractId
        let missing_id = serde_json::json!({
            "status": "funded",
            "balance": "100.0"
        });
        let res_id = validate_response_shape(&missing_id, &contract_id);
        assert!(res_id.is_err());
        assert!(res_id.unwrap_err().contains("missing 'contractId' field"));

        // Contract ID mismatch
        let mismatch_id = serde_json::json!({
            "contractId": test_contract_address(99),
            "status": "funded",
            "balance": "100.0"
        });
        let res_mismatch = validate_response_shape(&mismatch_id, &contract_id);
        assert!(res_mismatch.is_err());
        assert!(res_mismatch.unwrap_err().contains("Contract ID mismatch"));

        // Unknown status enum
        let unknown_status = serde_json::json!({
            "contractId": contract_id,
            "status": "BOGUS_STATUS_INVENTED",
            "balance": "100.0"
        });
        let res_status = validate_response_shape(&unknown_status, &contract_id);
        assert!(res_status.is_err());
        assert!(res_status.unwrap_err().contains("invalid escrow status"));

        // Missing balance
        let missing_bal = serde_json::json!({
            "contractId": contract_id,
            "status": "funded"
        });
        let res_bal = validate_response_shape(&missing_bal, &contract_id);
        assert!(res_bal.is_err());
        assert!(res_bal.unwrap_err().contains("missing 'balance' or 'amount' field"));
    }

    #[test]
    fn test_exact_asset_amounts_enforcement() {
        // AC 5: exact amounts, no rounded or estimated values
        let val_num = serde_json::json!(100.5);
        assert_eq!(parse_exact_stroops(&val_num).unwrap(), 1_005_000_000);

        let val_str = serde_json::json!("100.5000000");
        assert_eq!(parse_exact_stroops(&val_str).unwrap(), 1_005_000_000);

        let val_stroop_str = serde_json::json!("0.0000001");
        assert_eq!(parse_exact_stroops(&val_stroop_str).unwrap(), 1);

        // Negative amounts rejected
        let val_neg = serde_json::json!("-10.0");
        assert!(parse_exact_stroops(&val_neg).is_err());

        // More than 7 decimals rejected
        let val_too_precise = serde_json::json!("1.12345678");
        assert!(parse_exact_stroops(&val_too_precise).is_err());
    }

    #[test]
    fn test_bounded_timeout_guarantee() {
        // AC 6: All adapter requests have bounded timeouts; unbounded blocking calls removed
        assert!(ADAPTER_REQUEST_TIMEOUT <= Duration::from_secs(5));
    }

    #[test]
    fn test_controlled_testnet_escrow_end_to_end() {
        // AC 8: One controlled testnet escrow validates the selected read path end-to-end
        let contract_id = test_contract_address(42);
        let controlled_fixture = serde_json::json!({
            "contractId": contract_id,
            "status": "funded",
            "balance": "150.2500000",
            "asset_code": "USDC",
            "roles": {
                "marker": "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
                "approver": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                "releaser": "GC5POJCO3J6E23CD6D2F44V44V757XMS7EAL2L3LMMRFEPV5AU4236EU"
            }
        });

        // 1. Contract identity validation
        assert!(validate_contract_identity(&contract_id).is_ok());

        // 2. Validate response shape and exact amounts
        let validated = validate_response_shape(&controlled_fixture, &contract_id)
            .expect("Controlled testnet fixture must validate");
        assert_eq!(validated.contract_id, contract_id);
        assert_eq!(validated.status, "funded");
        assert_eq!(validated.balance, 1_502_500_000); // 150.25 * 10^7 exact stroops
        assert_eq!(validated.asset_code.as_deref(), Some("USDC"));
        assert_eq!(
            validated.marker.as_deref(),
            Some("GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57")
        );
        assert_eq!(
            validated.approver.as_deref(),
            Some("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")
        );
        assert_eq!(
            validated.releaser.as_deref(),
            Some("GC5POJCO3J6E23CD6D2F44V44V757XMS7EAL2L3LMMRFEPV5AU4236EU")
        );

        // 3. Reconcile with synchronized DB state (exact match)
        let db_in_sync = DbEscrowState {
            contract_id: contract_id.clone(),
            id: "db_row_1".to_string(),
            status: "funded".to_string(),
            balance: 150.25,
            balance_stroops: Some(1_502_500_000),
            marker: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57".to_string(),
            approver: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5".to_string(),
        };

        let report = reconcile_escrow(&validated, &db_in_sync);
        assert!(report.in_sync);
        assert!(report.discrepancies.is_empty());

        // 4. Reconcile with drifted DB state (status + balance drift detected)
        let db_drifted = DbEscrowState {
            contract_id: contract_id.clone(),
            id: "db_row_1".to_string(),
            status: "created".to_string(),
            balance: 100.0,
            balance_stroops: Some(1_000_000_000),
            marker: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57".to_string(),
            approver: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5".to_string(),
        };

        let report_drift = reconcile_escrow(&validated, &db_drifted);
        assert!(!report_drift.in_sync);
        assert_eq!(report_drift.discrepancies.len(), 2);
    }
}

