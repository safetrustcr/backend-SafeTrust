use constant_time_eq::constant_time_eq;
use hmac::{Hmac, Mac};
use neon::prelude::*;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Error raised when HMAC verification is asked to run with an empty key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    EmptySecret,
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerifyError::EmptySecret => write!(f, "HMAC secret must not be empty"),
        }
    }
}

/// Verify a TrustlessWork HMAC-SHA256 webhook signature.
///
/// Returns `Ok(true)` if and only if `payload` signed with `secret` matches
/// `signature`. Uses constant-time comparison to prevent timing attacks.
pub fn verify_hmac_sha256(
    payload: &[u8],
    signature: &str,
    secret: &[u8],
) -> Result<bool, VerifyError> {
    if secret.is_empty() {
        return Err(VerifyError::EmptySecret);
    }

    let mut mac =
        HmacSha256::new_from_slice(secret).expect("HMAC-SHA256 accepts any non-empty key length");
    mac.update(payload);

    let expected = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));

    // Lengths must match before the constant-time compare so we never
    // panic, and so a length mismatch cannot become a timing oracle on
    // the digest bytes themselves.
    let result = expected.len() == signature.len()
        && constant_time_eq(expected.as_bytes(), signature.as_bytes());

    Ok(result)
}

/// Validate a Stellar address using strkey encoding rules.
/// Returns true for valid G... public keys, false otherwise.
pub fn is_valid_stellar_address(address: &str) -> bool {
    address.starts_with('G')
        && address.len() == 56
        && address.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Verify a TrustlessWork HMAC-SHA256 webhook signature.
/// Returns true if and only if `payload` signed with `secret` matches `signature`.
/// Uses constant-time comparison to prevent timing attacks.
fn verify_hmac_signature(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let payload = cx.argument::<JsString>(0)?.value(&mut cx);
    let signature = cx.argument::<JsString>(1)?.value(&mut cx);
    let secret = cx.argument::<JsString>(2)?.value(&mut cx);

    match verify_hmac_sha256(payload.as_bytes(), &signature, secret.as_bytes()) {
        Ok(is_valid) => Ok(cx.boolean(is_valid)),
        Err(VerifyError::EmptySecret) => cx.throw_error(VerifyError::EmptySecret.to_string()),
    }
}

/// Validate a Stellar address using strkey encoding rules.
/// Returns true for valid G... public keys, false otherwise.
fn validate_stellar_address(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let address = cx.argument::<JsString>(0)?.value(&mut cx);
    Ok(cx.boolean(is_valid_stellar_address(&address)))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("verifyHmacSignature", verify_hmac_signature)?;
    cx.export_function("validateStellarAddress", validate_stellar_address)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(payload: &[u8], secret: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(secret).unwrap();
        mac.update(payload);
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn matching_signature_is_valid() {
        let payload = br#"{"contractId":"escrow-1","status":"funded"}"#;
        let secret = b"dev-secret";
        let signature = sign(payload, secret);
        assert_eq!(verify_hmac_sha256(payload, &signature, secret), Ok(true));
    }

    #[test]
    fn mismatched_signature_returns_false() {
        let payload = b"body";
        let secret = b"dev-secret";
        let signature = sign(b"different-body", secret);
        assert_eq!(verify_hmac_sha256(payload, &signature, secret), Ok(false));
    }

    #[test]
    fn wrong_secret_returns_false() {
        let payload = b"body";
        let signature = sign(payload, b"dev-secret");
        assert_eq!(
            verify_hmac_sha256(payload, &signature, b"other-secret"),
            Ok(false)
        );
    }

    #[test]
    fn empty_secret_is_an_error() {
        assert_eq!(
            verify_hmac_sha256(b"body", "sha256=abc", b""),
            Err(VerifyError::EmptySecret)
        );
    }

    #[test]
    fn malformed_signature_returns_false() {
        assert_eq!(
            verify_hmac_sha256(b"body", "not-a-valid-signature", b"dev-secret"),
            Ok(false)
        );
    }

    #[test]
    fn valid_stellar_g_address() {
        assert!(is_valid_stellar_address(
            "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z"
        ));
    }

    #[test]
    fn invalid_stellar_addresses() {
        assert!(!is_valid_stellar_address(""));
        assert!(!is_valid_stellar_address("not-an-address"));
        assert!(!is_valid_stellar_address(
            "XDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z"
        ));
        assert!(!is_valid_stellar_address("GSHORT"));
        assert!(!is_valid_stellar_address(
            "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7ZEXTRA"
        ));
    }
}
