use serde::{Deserialize, Serialize};

/// The X-Accepts-Payment header SafeTrust returns on 402 responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequirement {
    pub scheme: &'static str, // "exact"
    pub network: String,      // "stellar:testnet" or "stellar:mainnet"
    pub max_amount_usdc: f64, // e.g. 0.10
    pub asset: AssetInfo,
    pub facilitator_url: String,
    pub pay_to: String, // SafeTrust platform wallet address
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetInfo {
    pub code: &'static str, // "USDC"
    pub contract: String,   // SEP-41 contract address
    pub issuer: String,
}

/// Parsed X-Payment header from the client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X402PaymentHeader {
    pub scheme: String,
    pub network: String,
    pub payload: String, // base64-encoded signed Soroban auth entry
    pub amount: f64,
    #[serde(rename = "facilitatorUrl", alias = "facilitator_url", default)]
    pub facilitator_url: String,
}

/// Result from facilitator /verify endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FacilitatorVerifyResponse {
    #[serde(rename = "isValid", alias = "is_valid", default)]
    pub is_valid: bool,
    #[serde(rename = "invalidReason", alias = "invalid_reason", default)]
    pub invalid_reason: Option<String>,
    pub payer: Option<String>,
}

/// Result returned to Node.js middleware
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X402ValidationResult {
    pub is_valid: bool,
    pub payer_address: Option<String>,
    pub amount_usdc: f64,
    pub network: String,
    pub invalid_reason: Option<String>,
}
