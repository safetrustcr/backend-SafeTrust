use neon::prelude::*;
use std::sync::LazyLock;
use tokio::runtime::Runtime;

pub mod facilitator;
pub mod parser;
pub mod types;

static RUNTIME: LazyLock<Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to initialize x402 tokio runtime")
});

/// Validate an X-Payment header against the required amount.
/// Calls the facilitator /verify endpoint.
/// Returns JSON X402ValidationResult.
/// Never throws — errors returned in is_valid: false result.
fn validate_x402_payment(mut cx: FunctionContext) -> JsResult<JsString> {
    let header = cx.argument::<JsString>(0)?.value(&mut cx);
    let required_amount = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let result = RUNTIME.block_on(async {
        match parser::parse_x_payment_header(&header) {
            Err(e) => types::X402ValidationResult {
                is_valid: false,
                payer_address: None,
                amount_usdc: 0.0,
                network: String::new(),
                invalid_reason: Some(e),
            },
            Ok(payment) => {
                match facilitator::verify_with_facilitator(&payment, required_amount).await {
                    Ok(result) => {
                        // Fire-and-forget settle if valid
                        if result.is_valid {
                            let p = payment.clone();
                            let f = if payment.facilitator_url.is_empty() {
                                if payment.network.contains("mainnet") {
                                    facilitator::OPENZEPPELIN_FACILITATOR_MAINNET.to_string()
                                } else {
                                    facilitator::OPENZEPPELIN_FACILITATOR_TESTNET.to_string()
                                }
                            } else {
                                payment.facilitator_url.clone()
                            };
                            tokio::spawn(async move {
                                facilitator::settle_with_facilitator(&p, &f).await;
                            });
                        }
                        result
                    }
                    Err(e) => types::X402ValidationResult {
                        is_valid: false,
                        payer_address: None,
                        amount_usdc: 0.0,
                        network: payment.network,
                        invalid_reason: Some(e),
                    },
                }
            }
        }
    });

    let json = match serde_json::to_string(&result) {
        Ok(j) => j,
        Err(e) => return cx.throw_error(e.to_string()),
    };

    Ok(cx.string(json))
}

/// Build the X-Accepts-Payment header value for 402 responses.
/// Returns JSON PaymentRequirement.
fn build_payment_requirement(mut cx: FunctionContext) -> JsResult<JsString> {
    let amount_usdc = cx.argument::<JsNumber>(0)?.value(&mut cx);
    let network = cx.argument::<JsString>(1)?.value(&mut cx);
    let facilitator_url = cx.argument::<JsString>(2)?.value(&mut cx);
    let pay_to = cx.argument::<JsString>(3)?.value(&mut cx);

    let requirement = parser::build_payment_requirement(
        amount_usdc,
        &network,
        &facilitator_url,
        &pay_to,
    );

    let json = match serde_json::to_string(&requirement) {
        Ok(j) => j,
        Err(e) => return cx.throw_error(e.to_string()),
    };

    Ok(cx.string(json))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("validateX402Payment", validate_x402_payment)?;
    cx.export_function("buildPaymentRequirement", build_payment_requirement)?;
    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::parser::*;

    #[test]
    fn rejects_missing_x402_prefix() {
        let result = parse_x_payment_header("bearer sometoken");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with 'x402 '"));
    }

    #[test]
    fn rejects_non_stellar_network() {
        // Build a fake x402 header for Ethereum
        use base64::{engine::general_purpose, Engine as _};
        let payload = serde_json::json!({
            "scheme": "exact",
            "network": "ethereum:1",
            "payload": "abc",
            "amount": 0.10,
            "facilitatorUrl": ""
        });
        let encoded = general_purpose::STANDARD.encode(payload.to_string().as_bytes());
        let header = format!("x402 {}", encoded);
        let result = parse_x_payment_header(&header);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported network"));
    }

    #[test]
    fn rejects_zero_amount() {
        use base64::{engine::general_purpose, Engine as _};
        let payload = serde_json::json!({
            "scheme": "exact",
            "network": "stellar:testnet",
            "payload": "abc",
            "amount": 0.0,
            "facilitatorUrl": ""
        });
        let encoded = general_purpose::STANDARD.encode(payload.to_string().as_bytes());
        let header = format!("x402 {}", encoded);
        let result = parse_x_payment_header(&header);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be positive"));
    }

    #[test]
    fn rejects_negative_amount() {
        use base64::{engine::general_purpose, Engine as _};
        let payload = serde_json::json!({
            "scheme": "exact",
            "network": "stellar:testnet",
            "payload": "abc",
            "amount": -0.10,
            "facilitatorUrl": ""
        });
        let encoded = general_purpose::STANDARD.encode(payload.to_string().as_bytes());
        let header = format!("x402 {}", encoded);
        let result = parse_x_payment_header(&header);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be positive"));
    }

    #[test]
    fn facilitator_allowlist_checks() {
        use super::facilitator::*;
        assert!(is_allowed_facilitator("https://x402.org/facilitator"));
        assert!(is_allowed_facilitator("https://channels.openzeppelin.com/x402/testnet"));
        assert!(is_allowed_facilitator("https://channels.openzeppelin.com/x402"));
        assert!(!is_allowed_facilitator("https://attacker.evil/facilitator"));
        assert!(!is_allowed_facilitator("http://insecure.site"));
    }

    #[test]
    fn testnet_usdc_contract_correct() {
        let req = build_payment_requirement(
            0.10,
            "stellar:testnet",
            "https://channels.openzeppelin.com/x402/testnet",
            "GABC...",
        );
        assert_eq!(
            req.asset.contract,
            "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
        );
    }

    #[test]
    fn mainnet_usdc_contract_correct() {
        let req = build_payment_requirement(
            0.10,
            "stellar:mainnet",
            "https://channels.openzeppelin.com/x402",
            "GABC...",
        );
        assert_eq!(
            req.asset.contract,
            "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
        );
    }
}
