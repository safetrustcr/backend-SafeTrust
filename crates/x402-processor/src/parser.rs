use crate::types::{AssetInfo, PaymentRequirement, X402PaymentHeader};
use base64::{engine::general_purpose, Engine as _};

/// Parse the X-Payment header value per x402 v2 spec.
/// Format: "x402 <base64-encoded-json-payload>"
pub fn parse_x_payment_header(header: &str) -> Result<X402PaymentHeader, String> {
    let header = header.trim();

    // Must start with "x402 " scheme prefix
    let payload_b64 = header
        .strip_prefix("x402 ")
        .ok_or_else(|| {
            format!(
                "Invalid X-Payment header format — must start with 'x402 ', got: '{}'",
                &header[..header.len().min(20)]
            )
        })?;

    let payload_bytes = general_purpose::STANDARD
        .decode(payload_b64.trim())
        .map_err(|e| format!("X-Payment base64 decode failed: {}", e))?;

    let payment: X402PaymentHeader = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("X-Payment JSON parse failed: {}", e))?;

    // Validate network is Stellar
    if !payment.network.starts_with("stellar") {
        return Err(format!(
            "Unsupported network: '{}' — SafeTrust only accepts Stellar payments",
            payment.network
        ));
    }

    // Validate amount is positive
    if payment.amount <= 0.0 {
        return Err(format!(
            "Invalid payment amount: {} — must be positive",
            payment.amount
        ));
    }

    Ok(payment)
}

/// Build the X-Accepts-Payment header value for 402 responses
pub fn build_payment_requirement(
    amount_usdc: f64,
    network: &str,
    facilitator_url: &str,
    pay_to: &str,
) -> PaymentRequirement {
    // USDC contract addresses per Stellar docs
    let (usdc_contract, usdc_issuer) = if network.contains("mainnet") {
        (
            "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
            "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        )
    } else {
        // testnet
        (
            "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
            "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        )
    };

    PaymentRequirement {
        scheme: "exact",
        network: network.to_string(),
        max_amount_usdc: amount_usdc,
        asset: AssetInfo {
            code: "USDC",
            contract: usdc_contract.to_string(),
            issuer: usdc_issuer.to_string(),
        },
        facilitator_url: facilitator_url.to_string(),
        pay_to: pay_to.to_string(),
        description: "SafeTrust booking fee".to_string(),
    }
}
