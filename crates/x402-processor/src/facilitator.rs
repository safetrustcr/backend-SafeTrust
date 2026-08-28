use crate::types::{FacilitatorVerifyResponse, X402PaymentHeader, X402ValidationResult};
use reqwest::Client;
use std::time::Duration;

pub const COINBASE_FACILITATOR_TESTNET: &str = "https://x402.org/facilitator";
pub const OPENZEPPELIN_FACILITATOR_TESTNET: &str = "https://channels.openzeppelin.com/x402/testnet";
pub const OPENZEPPELIN_FACILITATOR_MAINNET: &str = "https://channels.openzeppelin.com/x402";

pub const ALLOWED_FACILITATORS: &[&str] = &[
    COINBASE_FACILITATOR_TESTNET,
    OPENZEPPELIN_FACILITATOR_TESTNET,
    OPENZEPPELIN_FACILITATOR_MAINNET,
];

pub fn is_allowed_facilitator(url: &str) -> bool {
    let normalized = url.trim().trim_end_matches('/');
    ALLOWED_FACILITATORS.iter().any(|allowed| allowed.trim_end_matches('/') == normalized)
}

/// Verify an x402 payment with the facilitator.
/// Calls POST /verify on the facilitator URL from the payment header.
pub async fn verify_with_facilitator(
    payment: &X402PaymentHeader,
    required_amount: f64,
) -> Result<X402ValidationResult, String> {
    // Use the facilitator URL from the payment header if in allowlist, otherwise default
    let facilitator_url = if payment.facilitator_url.is_empty() {
        if payment.network.contains("mainnet") {
            OPENZEPPELIN_FACILITATOR_MAINNET
        } else {
            OPENZEPPELIN_FACILITATOR_TESTNET
        }
    } else {
        if !is_allowed_facilitator(&payment.facilitator_url) {
            return Ok(X402ValidationResult {
                is_valid: false,
                payer_address: None,
                amount_usdc: payment.amount,
                network: payment.network.clone(),
                invalid_reason: Some(format!(
                    "Untrusted facilitator URL: '{}' is not in allowlist",
                    payment.facilitator_url
                )),
            });
        }
        &payment.facilitator_url
    };

    // Validate amount meets minimum before calling facilitator
    if payment.amount < required_amount {
        return Ok(X402ValidationResult {
            is_valid: false,
            payer_address: None,
            amount_usdc: payment.amount,
            network: payment.network.clone(),
            invalid_reason: Some(format!(
                "Insufficient payment: {} USDC < required {} USDC",
                payment.amount, required_amount
            )),
        });
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client build failed: {}", e))?;

    let verify_url = format!("{}/verify", facilitator_url.trim_end_matches('/'));
    let response = client
        .post(&verify_url)
        .json(&serde_json::json!({
            "x402Version": 2,
            "scheme": payment.scheme,
            "network": payment.network,
            "payload": payment.payload,
            "amount": payment.amount.to_string(),
        }))
        .send()
        .await
        .map_err(|e| format!("Facilitator /verify request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Facilitator returned {}: {}", status, body));
    }

    let verify_result: FacilitatorVerifyResponse = response
        .json()
        .await
        .map_err(|e| format!("Facilitator /verify response parse failed: {}", e))?;

    Ok(X402ValidationResult {
        is_valid: verify_result.is_valid,
        payer_address: verify_result.payer,
        amount_usdc: payment.amount,
        network: payment.network.clone(),
        invalid_reason: verify_result.invalid_reason,
    })
}

/// Settle the payment asynchronously after serving the response.
/// Called in a background task — never blocks the API response.
pub async fn settle_with_facilitator(
    payment: &X402PaymentHeader,
    facilitator_url: &str,
) {
    let client = match Client::builder().timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[x402] Failed to build HTTP client for settle: {}", e);
            return;
        }
    };

    let settle_url = format!("{}/settle", facilitator_url.trim_end_matches('/'));
    match client
        .post(&settle_url)
        .json(&serde_json::json!({
            "x402Version": 2,
            "scheme": payment.scheme,
            "network": payment.network,
            "payload": payment.payload,
        }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            println!("[x402] ✅ Payment settled — network: {}", payment.network)
        }
        Ok(r) => eprintln!("[x402] ⚠️ Settle returned {}", r.status()),
        Err(e) => eprintln!("[x402] ⚠️ Settle failed: {}", e),
    }
}
