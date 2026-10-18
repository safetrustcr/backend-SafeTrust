use crate::types::SorobanEscrowState;
#[cfg(feature = "unvalidated-reader")]
use serde_json::json;
#[cfg(feature = "unvalidated-reader")]
use std::env;

/// Whether the unvalidated reader is compiled in.
///
/// The feature is off by default. Even a build that enables it refuses to run
/// unless the operator also sets `SOROBAN_RECONCILER_ALLOW_UNVALIDATED=true`.
#[cfg(feature = "unvalidated-reader")]
fn reader_allowed() -> bool {
    env::var("SOROBAN_RECONCILER_ALLOW_UNVALIDATED")
        .map(|value| value == "true")
        .unwrap_or(false)
}

#[cfg(not(feature = "unvalidated-reader"))]
fn reader_allowed() -> bool {
    false
}

/// Query Soroban RPC for on-chain escrow state.
///
/// **Quarantined.** The implementation below does not decode contract storage:
/// it returns a hardcoded `ACTIVE` / `1_000_000_000` state for `mock_` and
/// `test_` ids, and for every other id it only checks `getHealth` before
/// returning the same hardcoded state. Treating that as chain truth would let
/// reconciliation overwrite real database rows with fabricated values, so the
/// reader is disabled by default.
///
/// A validated adapter must read the escrow contract's ledger entry (for
/// example with `getLedgerEntries` plus contract-data decoding), pin the
/// contract id and network, reject stale ledgers, and return an error instead
/// of a default state when the entry is missing. Rebuilding it is tracked as a
/// separate task; see `docs/architecture/crate-boundaries.md`.
pub fn query_escrow_state(contract_id: &str, network: &str) -> Result<SorobanEscrowState, String> {
    if !reader_allowed() {
        return Err(
            "soroban-reconciler: the Soroban reader is quarantined because it does not \
             read contract storage. Rebuild it as a validated adapter before enabling it \
             (requires the `unvalidated-reader` Cargo feature and \
             SOROBAN_RECONCILER_ALLOW_UNVALIDATED=true)."
                .to_string(),
        );
    }

    #[cfg(feature = "unvalidated-reader")]
    {
        query_escrow_state_unvalidated(contract_id, network)
    }

    #[cfg(not(feature = "unvalidated-reader"))]
    {
        let _ = (contract_id, network);
        unreachable!("reader_allowed() is always false without the unvalidated-reader feature")
    }
}

/// The legacy, unvalidated reader. Never call this outside the opt-in path
/// above; it is retained only so the follow-up adapter work has a reference
/// implementation to replace.
#[cfg(feature = "unvalidated-reader")]
fn query_escrow_state_unvalidated(
    contract_id: &str,
    network: &str,
) -> Result<SorobanEscrowState, String> {
    if contract_id.starts_with("mock_") || contract_id.starts_with("test_") {
        return Ok(SorobanEscrowState {
            contract_id: contract_id.to_string(),
            status: "ACTIVE".to_string(),
            balance: 1_000_000_000, // 100 XLM in Stroops (10^7 per XLM)
            marker: Some("marker_on_chain".to_string()),
            approver: Some("approver_on_chain".to_string()),
        });
    }

    let rpc_url = env::var("SOROBAN_RPC_URL").unwrap_or_else(|_| match network {
        "mainnet" => "https://soroban.stellar.org".to_string(),
        _ => "https://soroban-testnet.stellar.org".to_string(),
    });

    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getHealth",
        "params": []
    });

    let resp = ureq::post(&rpc_url)
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(5))
        .send_json(body);

    match resp {
        Ok(res) => {
            let json_resp: serde_json::Value = res
                .into_json()
                .map_err(|e| format!("Failed to parse JSON-RPC response: {}", e))?;

            if let Some(err) = json_resp.get("error") {
                return Err(format!("Soroban RPC error: {}", err));
            }

            Ok(SorobanEscrowState {
                contract_id: contract_id.to_string(),
                status: "ACTIVE".to_string(),
                balance: 1_000_000_000,
                marker: Some("marker_on_chain".to_string()),
                approver: Some("approver_on_chain".to_string()),
            })
        }
        Err(e) => Err(format!(
            "Failed to connect to Soroban RPC at {}: {}",
            rpc_url, e
        )),
    }
}
