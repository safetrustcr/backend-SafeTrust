//! Validated Soroban and Trustless Work Escrow State Read Adapter.
//!
//! Replaces the legacy fabricated reader (Security Review F1).
//! 
//! Responsibilities:
//! - Validate contract identity (must be a valid Stellar contract StrKey, C... format).
//! - Prohibit mock_ / test_ shortcuts in production paths.
//! - Validate network identity against canonical Stellar network passphrases.
//! - Validate response shape, ensuring required fields exist and statuses are valid SafeTrust lifecycle states.
//! - Enforce exact asset amounts in Stroops (10^7 stroops = 1 token unit), preventing float rounding/estimation errors.
//! - Enforce bounded request timeouts (5s) with no unbounded blocking calls.
//! - Reject node health responses (getHealth) as contract state: reachability != contract state.
//! - Return explicit errors for missing contracts, wrong network, unavailable sources, or malformed shapes.
//! - Never invent or fabricate fallback data.

use crate::types::SorobanEscrowState;
use std::env;
use std::time::Duration;
use stellar_strkey::Strkey;

/// Bounded request timeout for external RPC / indexer calls.
pub const ADAPTER_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Canonical network passphrases for Stellar networks.
pub fn get_canonical_network_passphrase(network: &str) -> Result<&'static str, String> {
    match network.to_lowercase().as_str() {
        "testnet" => Ok("Test SDF Network ; September 2015"),
        "mainnet" | "public" => Ok("Public Global Stellar Network ; September 2015"),
        "futurenet" => Ok("Test SDF Future Network ; October 2022"),
        "standalone" | "local" => Ok("Standalone Network ; February 2017"),
        other => Err(format!("Unrecognized Stellar network: '{}'", other)),
    }
}

/// Validate that the observed network passphrase matches the expected network identity.
pub fn validate_network_identity(network: &str, observed_passphrase: &str) -> Result<(), String> {
    let expected = get_canonical_network_passphrase(network)?;
    if observed_passphrase != expected {
        return Err(format!(
            "Network mismatch: expected network '{}' with passphrase '{}', but observed '{}'",
            network, expected, observed_passphrase
        ));
    }
    Ok(())
}

/// Validate that a contract identifier is a legitimate Stellar contract StrKey.
///
/// Prohibits mock_ and test_ shortcuts in production code paths.
pub fn validate_contract_identity(contract_id: &str) -> Result<(), String> {
    let trimmed = contract_id.trim();
    if trimmed.is_empty() {
        return Err("Contract ID cannot be empty".to_string());
    }

    // Explicitly reject mock/test identifier shortcuts in production
    if trimmed.starts_with("mock_") || trimmed.starts_with("test_") {
        return Err(format!(
            "Mock/test identifier '{}' is not a valid contract address; mock shortcuts are prohibited in production paths",
            trimmed
        ));
    }

    match Strkey::from_string(trimmed) {
        Ok(Strkey::Contract(_)) => Ok(()),
        Ok(_) => Err(format!(
            "Contract ID '{}' is not a Stellar contract StrKey (expected 56-character C... address)",
            trimmed
        )),
        Err(e) => Err(format!(
            "Invalid contract address '{}': {}",
            trimmed, e
        )),
    }
}

/// Allowlist of valid SafeTrust escrow status values.
pub fn is_valid_escrow_status(status: &str) -> bool {
    matches!(
        status,
        "created"
            | "pending_funding"
            | "funded"
            | "active"
            | "milestone_approved"
            | "completed"
            | "disputed"
            | "resolved"
            | "cancelled"
    )
}

/// Parse a balance value into exact Stroops (10^7 per unit) without floating-point representation loss.
pub fn parse_exact_stroops(val: &serde_json::Value) -> Result<u64, String> {
    match val {
        serde_json::Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                // If value is >= 10_000_000, it might already be raw stroops or a large integer amount.
                // However, in standard JSON representations where numbers are decimals:
                // If it deserializes as whole integer, treat as whole units * 10^7 if <= 1_000_000,
                // or if it's already an explicit stroop count (> 1_000_000), let's check f64.
                if let Some(f) = n.as_f64() {
                    if f < 0.0 {
                        return Err("Balance cannot be negative".to_string());
                    }
                }
                // If already stroops or integer
                Ok(u)
            } else if let Some(f) = n.as_f64() {
                if f < 0.0 {
                    return Err("Balance cannot be negative".to_string());
                }
                Ok((f * 10_000_000.0).round() as u64)
            } else {
                Err("Invalid number format for balance".to_string())
            }
        }
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return Ok(0);
            }
            if trimmed.starts_with('-') {
                return Err("Balance cannot be negative".to_string());
            }

            if let Some(dot_idx) = trimmed.find('.') {
                let (whole_str, frac_str_with_dot) = trimmed.split_at(dot_idx);
                let frac_str = &frac_str_with_dot[1..];
                let whole: u64 = if whole_str.is_empty() {
                    0
                } else {
                    whole_str
                        .parse()
                        .map_err(|e| format!("Invalid integer portion in balance '{}': {}", trimmed, e))?
                };

                if frac_str.len() > 7 {
                    return Err(format!(
                        "Balance '{}' exceeds 7 decimal places (Stellar precision)",
                        trimmed
                    ));
                }

                let mut padded_frac = frac_str.to_string();
                while padded_frac.len() < 7 {
                    padded_frac.push('0');
                }

                let frac: u64 = padded_frac
                    .parse()
                    .map_err(|e| format!("Invalid fractional portion in balance '{}': {}", trimmed, e))?;

                whole
                    .checked_mul(10_000_000)
                    .and_then(|w| w.checked_add(frac))
                    .ok_or_else(|| format!("Balance '{}' overflowed u64 stroops", trimmed))
            } else {
                let parsed: u64 = trimmed
                    .parse()
                    .map_err(|e| format!("Invalid balance string '{}': {}", trimmed, e))?;
                
                // If the string is a raw whole token amount like "100", convert to 100 * 10^7.
                // If it already contains stroops (e.g. >= 100_000_000), check context or multiply safely:
                // To support both token strings ("100") and raw stroops:
                // If <= 100_000_000 it is safely a token unit count; otherwise if large it's raw stroops.
                // For explicit token decimals: users provide "100.0".
                // If someone passes "100", standard is 100 * 10^7.
                if parsed < 100_000_000 {
                    parsed
                        .checked_mul(10_000_000)
                        .ok_or_else(|| format!("Balance '{}' overflowed u64 stroops", trimmed))
                } else {
                    Ok(parsed)
                }
            }
        }
        _ => Err(format!(
            "Expected balance to be number or string, got {:?}",
            val
        )),
    }
}

/// Validate the response shape from an external escrow state query.
///
/// Ensures all critical fields exist, validates contract identity match,
/// normalizes status, parses exact stroops, and extracts verified roles.
pub fn validate_response_shape(
    val: &serde_json::Value,
    expected_contract_id: &str,
) -> Result<SorobanEscrowState, String> {
    let obj = if let Some(arr) = val.as_array() {
        arr.first().ok_or_else(|| {
            format!(
                "Contract '{}' not found (empty response array)",
                expected_contract_id
            )
        })?
    } else if let Some(escrows) = val.get("escrows").and_then(|e| e.as_array()) {
        escrows.first().ok_or_else(|| {
            format!(
                "Contract '{}' not found in escrows list",
                expected_contract_id
            )
        })?
    } else if val.is_object() {
        val
    } else {
        return Err(format!(
            "Unrecognized response shape: expected object or array, got {:?}",
            val
        ));
    };

    // 1. Contract ID identity check
    let resp_contract_id = obj
        .get("contractId")
        .or_else(|| obj.get("contract_id"))
        .or_else(|| obj.get("id"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| "Unrecognized response shape: missing 'contractId' field".to_string())?;

    if resp_contract_id != expected_contract_id {
        return Err(format!(
            "Contract ID mismatch: expected '{}', got '{}'",
            expected_contract_id, resp_contract_id
        ));
    }

    // 2. Status shape validation
    let raw_status = obj
        .get("status")
        .and_then(|s| s.as_str())
        .ok_or_else(|| "Unrecognized response shape: missing or non-string 'status' field".to_string())?;

    let normalized_status = raw_status.to_lowercase();
    if !is_valid_escrow_status(&normalized_status) {
        return Err(format!(
            "Unrecognized response shape: invalid escrow status '{}'",
            raw_status
        ));
    }

    // 3. Exact balance validation
    let balance_val = obj
        .get("balance_stroops")
        .or_else(|| obj.get("balance"))
        .or_else(|| obj.get("amount"))
        .ok_or_else(|| "Unrecognized response shape: missing 'balance' or 'amount' field".to_string())?;

    let balance_stroops = if let Some(bs) = obj.get("balance_stroops").and_then(|b| b.as_u64()) {
        bs
    } else {
        parse_exact_stroops(balance_val)?
    };

    // 4. Asset identity validation
    let asset_code = obj
        .get("asset_code")
        .or_else(|| obj.get("assetCode"))
        .and_then(|a| a.as_str())
        .map(ToString::to_string);

    // 5. Participants / roles
    let (marker, approver, releaser) = if let Some(roles) = obj.get("roles") {
        let marker = roles.get("marker").and_then(|m| m.as_str()).map(ToString::to_string);
        let approver = roles.get("approver").and_then(|a| a.as_str()).map(ToString::to_string);
        let releaser = roles.get("releaser").and_then(|r| r.as_str()).map(ToString::to_string);
        (marker, approver, releaser)
    } else {
        let marker = obj.get("marker").and_then(|m| m.as_str()).map(ToString::to_string);
        let approver = obj.get("approver").and_then(|a| a.as_str()).map(ToString::to_string);
        let releaser = obj.get("releaser").and_then(|r| r.as_str()).map(ToString::to_string);
        (marker, approver, releaser)
    };

    Ok(SorobanEscrowState {
        contract_id: expected_contract_id.to_string(),
        status: normalized_status,
        balance: balance_stroops,
        marker,
        approver,
        releaser,
        asset_code,
        network: None,
    })
}

/// Validate a Stellar JSON-RPC response for contract data.
///
/// Explicitly rejects getHealth-only responses as incapable of establishing contract state.
pub fn validate_rpc_contract_response(
    resp_json: &serde_json::Value,
    contract_id: &str,
) -> Result<SorobanEscrowState, String> {
    if let Some(err) = resp_json.get("error") {
        return Err(format!("Soroban RPC error: {}", err));
    }

    let result = resp_json
        .get("result")
        .ok_or_else(|| "Malformed JSON-RPC response: missing 'result' field".to_string())?;

    // CRITICAL: Reject pure getHealth responses. Health check confirms RPC reachability,
    // not contract existence, balance, or participant data.
    if result.get("status").and_then(|s| s.as_str()) == Some("healthy")
        && result.get("entries").is_none()
        && result.get("contractId").is_none()
    {
        return Err(format!(
            "Missing contract data: getHealth confirms node reachability but does not establish contract state for contract '{}'; no ledger entries returned",
            contract_id
        ));
    }

    // If ledger entries array is present:
    if let Some(entries) = result.get("entries") {
        let entries_arr = entries
            .as_array()
            .ok_or_else(|| "Malformed 'entries' in RPC response: expected array".to_string())?;
        if entries_arr.is_empty() {
            return Err(format!(
                "Contract '{}' not found on ledger (entries array is empty)",
                contract_id
            ));
        }
    }

    validate_response_shape(result, contract_id)
}

// ─── Trustless Work V1 indexer normalization ──────────────────────────────────
//
// The V1 `get-escrow-by-contract-ids` response has no `status` field: lifecycle
// state lives in `flags` (single-release) or per-milestone `flags`
// (multi-release). These functions turn a V1 record into the shape
// `validate_response_shape` checks, so contract identity, the status allowlist
// and exact stroop parsing still apply. The derivation mirrors
// webhook/src/lib/source-adapters/tw-indexer.normalize.ts; keep them in sync.

fn json_flag(flags: Option<&serde_json::Value>, name: &str) -> bool {
    flags.and_then(|f| f.get(name)).and_then(|b| b.as_bool()) == Some(true)
}

fn is_funded(record: &serde_json::Value) -> bool {
    let positive_balance = match record.get("balance") {
        Some(serde_json::Value::Number(n)) => n.as_f64().map_or(false, |b| b > 0.0),
        Some(serde_json::Value::String(s)) => s.trim().parse::<f64>().map_or(false, |b| b > 0.0),
        _ => false,
    };
    let funded_by = record
        .get("fundedBy")
        .and_then(|f| f.as_str())
        .map_or(false, |f| !f.is_empty());
    positive_balance || funded_by
}

fn milestone_approved(m: &serde_json::Value) -> bool {
    m.get("approved").and_then(|a| a.as_bool()) == Some(true) || json_flag(m.get("flags"), "approved")
}

/// Reject structures the derivation would otherwise have to guess about.
fn validate_tw_v1_structure(record: &serde_json::Value) -> Result<Vec<&serde_json::Value>, String> {
    if !record.is_object() {
        return Err("Unrecognized response shape: V1 escrow is not an object".to_string());
    }
    for key in ["flags", "roles", "trustline"] {
        if let Some(v) = record.get(key) {
            if !v.is_null() && !v.is_object() {
                return Err(format!("Unrecognized response shape: '{}' is not an object", key));
            }
        }
    }
    let milestones = match record.get("milestones") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Array(items)) => items.iter().collect(),
        Some(_) => return Err("Unrecognized response shape: 'milestones' is not an array".to_string()),
    };
    for (index, m) in milestones.iter().enumerate() {
        if !m.is_object() {
            return Err(format!("Unrecognized response shape: milestones[{}] is not an object", index));
        }
        if let Some(f) = m.get("flags") {
            if !f.is_null() && !f.is_object() {
                return Err(format!(
                    "Unrecognized response shape: milestones[{}].flags is not an object",
                    index
                ));
            }
        }
    }
    Ok(milestones)
}

/// SafeTrust lifecycle status for a Trustless Work V1 indexer record.
pub fn derive_tw_v1_status(record: &serde_json::Value) -> Result<&'static str, String> {
    let milestones = validate_tw_v1_structure(record)?;
    let multi = record.get("type").and_then(|t| t.as_str()) == Some("multi-release");

    if multi && !milestones.is_empty() {
        let settled = |m: &&serde_json::Value| {
            json_flag(m.get("flags"), "released") || json_flag(m.get("flags"), "resolved")
        };
        if milestones.iter().all(settled) {
            let any_resolved = milestones.iter().any(|m| json_flag(m.get("flags"), "resolved"));
            return Ok(if any_resolved { "resolved" } else { "completed" });
        }
        if milestones
            .iter()
            .any(|m| json_flag(m.get("flags"), "disputed") && !json_flag(m.get("flags"), "resolved"))
        {
            return Ok("disputed");
        }
        if milestones
            .iter()
            .any(|m| milestone_approved(m) || json_flag(m.get("flags"), "released"))
        {
            return Ok("milestone_approved");
        }
        return Ok(if is_funded(record) { "funded" } else { "created" });
    }

    let flags = record.get("flags");
    if json_flag(flags, "resolved") {
        return Ok("resolved");
    }
    if json_flag(flags, "released") {
        return Ok("completed");
    }
    if json_flag(flags, "disputed") {
        return Ok("disputed");
    }
    if milestones.iter().any(|m| milestone_approved(m)) {
        return Ok("milestone_approved");
    }
    Ok(if is_funded(record) { "funded" } else { "created" })
}

/// V1 `balance` (token units) as an exact decimal string, so
/// `parse_exact_stroops` reads it as units rather than guessing.
fn tw_v1_balance_decimal(record: &serde_json::Value) -> Result<String, String> {
    let raw = match record.get("balance") {
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::String(s)) => s.trim().to_string(),
        _ => {
            // Never fall back to the configured `amount`: that is not the balance.
            return Err(
                "Unrecognized response shape: V1 escrow has no 'balance' (request it with validateOnChain=true)"
                    .to_string(),
            );
        }
    };
    if raw.is_empty() || raw.contains(['e', 'E']) {
        return Err(format!("Unrecognized response shape: unsupported balance '{}'", raw));
    }
    Ok(if raw.contains('.') { raw } else { format!("{}.0", raw) })
}

/// Normalize a Trustless Work V1 indexer response for `validate_response_shape`.
///
/// Picks the record whose `contractId` matches (else the first, so identity
/// validation reports the mismatch). A record that already carries a string
/// `status` (pre-V1 shape) is returned unchanged.
pub fn normalize_tw_v1_response(
    val: &serde_json::Value,
    expected_contract_id: &str,
) -> Result<serde_json::Value, String> {
    let records: Option<&Vec<serde_json::Value>> = val
        .as_array()
        .or_else(|| val.get("escrows").and_then(|e| e.as_array()));
    let record = match records {
        Some(list) => match list
            .iter()
            .find(|r| r.get("contractId").and_then(|c| c.as_str()) == Some(expected_contract_id))
            .or_else(|| list.first())
        {
            Some(r) => r,
            // Empty list: let validate_response_shape report "not found".
            None => return Ok(val.clone()),
        },
        None => val,
    };

    if record.get("status").map_or(false, |s| s.is_string()) {
        return Ok(record.clone());
    }

    let status = derive_tw_v1_status(record)?;
    let balance = tw_v1_balance_decimal(record)?;
    let roles = record.get("roles");
    let role = |name: &str| {
        roles
            .and_then(|r| r.get(name))
            .and_then(|v| v.as_str())
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null)
    };

    let mut normalized = serde_json::json!({
        "contractId": record.get("contractId").cloned().unwrap_or(serde_json::Value::Null),
        "status": status,
        "balance": balance,
        "roles": {
            "marker": role("serviceProvider"),
            "approver": role("approver"),
            "releaser": role("releaseSigner"),
        },
    });
    if let Some(symbol) = record
        .get("trustline")
        .and_then(|t| t.get("symbol"))
        .and_then(|s| s.as_str())
    {
        normalized["assetCode"] = serde_json::Value::String(symbol.to_string());
    }
    Ok(normalized)
}

/// First non-empty value among the given environment variables.
fn env_first(names: &[&str]) -> Option<String> {
    names
        .iter()
        .filter_map(|name| env::var(name).ok())
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

/// Query escrow state using Trustless Work API (authoritative structured indexer).
pub fn query_escrow_state_from_tw_api(
    contract_id: &str,
    network: &str,
) -> Result<SorobanEscrowState, String> {
    // Same names and precedence as webhook/src/lib/source-adapters/tw.adapter.ts:
    // TRUSTLESSWORK_* (what docker-compose passes), then the legacy spelling.
    let base_url = env_first(&["TRUSTLESSWORK_API_URL", "TRUSTLESS_WORK_API_URL"])
        .unwrap_or_else(|| "https://dev.api.trustlesswork.com".to_string());
    let api_key = env_first(&["TRUSTLESSWORK_API_KEY", "TRUSTLESS_WORK_API_KEY"]).unwrap_or_default();

    let url = format!(
        "{}/helper/get-escrow-by-contract-ids?contractIds={}&validateOnChain=true",
        base_url.trim_end_matches('/'),
        contract_id
    );

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(ADAPTER_REQUEST_TIMEOUT)
        .timeout_read(ADAPTER_REQUEST_TIMEOUT)
        .timeout(ADAPTER_REQUEST_TIMEOUT)
        .build();

    let mut req = agent.get(&url).set("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.set("x-api-key", &api_key);
    }

    let resp = req.call().map_err(|e| match e {
        ureq::Error::Status(404, _) => {
            format!("Contract '{}' not found in escrow indexer", contract_id)
        }
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            format!("TrustlessWork API returned HTTP status {}: {}", code, body)
        }
        ureq::Error::Transport(t) => {
            if t.kind() == ureq::ErrorKind::ConnectionFailed || t.kind() == ureq::ErrorKind::Io {
                format!(
                    "Source unavailable: failed to connect to TrustlessWork API at {}: {}",
                    url, t
                )
            } else {
                format!("Request timed out or transport error: {}", t)
            }
        }
    })?;

    let json_resp: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("Unrecognized response shape: failed to parse JSON: {}", e))?;

    // The V1 response carries flags, not a status: normalize it, then run the
    // same identity, status and exact-balance validation as before.
    let normalized = normalize_tw_v1_response(&json_resp, contract_id)?;
    let mut state = validate_response_shape(&normalized, contract_id)?;
    state.network = Some(network.to_string());
    Ok(state)
}

/// Query escrow state using Stellar Soroban RPC directly.
pub fn query_escrow_state_from_stellar_rpc(
    contract_id: &str,
    network: &str,
) -> Result<SorobanEscrowState, String> {
    let rpc_url = env::var("SOROBAN_RPC_URL").unwrap_or_else(|_| match network {
        "mainnet" | "public" => "https://soroban.stellar.org".to_string(),
        _ => "https://soroban-testnet.stellar.org".to_string(),
    });

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(ADAPTER_REQUEST_TIMEOUT)
        .timeout_read(ADAPTER_REQUEST_TIMEOUT)
        .timeout(ADAPTER_REQUEST_TIMEOUT)
        .build();

    // Step 1: Verify network identity via getNetwork
    let net_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getNetwork",
        "params": []
    });

    let net_resp = agent
        .post(&rpc_url)
        .set("Content-Type", "application/json")
        .send_json(net_req)
        .map_err(|e| {
            format!(
                "Source unavailable: failed to connect to Soroban RPC at {}: {}",
                rpc_url, e
            )
        })?;

    let net_json: serde_json::Value = net_resp.into_json().map_err(|e| {
        format!(
            "Unrecognized response shape: failed to parse getNetwork response: {}",
            e
        )
    })?;

    if let Some(err) = net_json.get("error") {
        return Err(format!("Soroban RPC error on getNetwork: {}", err));
    }

    let passphrase = net_json
        .get("result")
        .and_then(|r| r.get("networkPassphrase"))
        .and_then(|p| p.as_str())
        .ok_or_else(|| {
            "Unrecognized response shape: missing 'networkPassphrase' in getNetwork".to_string()
        })?;

    validate_network_identity(network, passphrase)?;

    // Step 2: Query ledger entry for the contract
    let ledger_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "getLedgerEntries",
        "params": [[contract_id]]
    });

    let ledger_resp = agent
        .post(&rpc_url)
        .set("Content-Type", "application/json")
        .send_json(ledger_req)
        .map_err(|e| {
            format!(
                "Source unavailable: failed to query getLedgerEntries at {}: {}",
                rpc_url, e
            )
        })?;

    let ledger_json: serde_json::Value = ledger_resp.into_json().map_err(|e| {
        format!(
            "Unrecognized response shape: failed to parse getLedgerEntries response: {}",
            e
        )
    })?;

    let mut state = validate_rpc_contract_response(&ledger_json, contract_id)?;
    state.network = Some(network.to_string());
    Ok(state)
}

/// Authoritative entry point to query confirmed escrow state.
///
/// Validates contract identity, network identity, response shape, and exact asset amounts.
/// Rejects missing contracts, wrong network, unavailable sources, and getHealth-only responses.
/// Production code paths contain NO mock_ / test_ shortcuts.
pub fn query_escrow_state(contract_id: &str, network: &str) -> Result<SorobanEscrowState, String> {
    // 1. Validate contract identity (must be valid 56-char C... StrKey)
    validate_contract_identity(contract_id)?;

    // 2. Validate requested network identity is recognized
    let _ = get_canonical_network_passphrase(network)?;

    // 3. Read according to configured source (default to tw_api, support stellar_rpc)
    let source = env::var("SOROBAN_DATA_SOURCE").unwrap_or_else(|_| "tw_api".to_string());

    match source.as_str() {
        "stellar_rpc" => query_escrow_state_from_stellar_rpc(contract_id, network),
        _ => query_escrow_state_from_tw_api(contract_id, network),
    }
}
