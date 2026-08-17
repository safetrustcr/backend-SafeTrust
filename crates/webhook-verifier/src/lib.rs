use constant_time_eq::constant_time_eq;
use hmac::{Hmac, Mac};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const STRKEY_LEN: usize = 56;
const STRKEY_DECODED_LEN: usize = 35; // version (1) + payload (32) + checksum (2)
const STRKEY_VERSION_ED25519_PUBLIC: u8 = 0x30;

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

fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

fn decode_base32_strkey(address: &str) -> Option<[u8; STRKEY_DECODED_LEN]> {
    if address.len() != STRKEY_LEN {
        return None;
    }

    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    let mut out = [0u8; STRKEY_DECODED_LEN];
    let mut idx = 0;

    for b in address.bytes() {
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'2'..=b'7' => 26 + (b - b'2'),
            _ => return None,
        };
        bits = (bits << 5) | u32::from(val);
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            if idx >= STRKEY_DECODED_LEN {
                return None;
            }
            out[idx] = (bits >> bit_count) as u8;
            idx += 1;
        }
    }

    if idx != STRKEY_DECODED_LEN {
        return None;
    }
    Some(out)
}

/// Validate a Stellar address using strkey encoding rules.
///
/// Fully decodes the Base32 payload, requires version byte `0x30`
/// (ed25519 public key / `G…`), and verifies the CRC16-XModem checksum.
pub fn is_valid_stellar_address(address: &str) -> bool {
    let decoded = match decode_base32_strkey(address) {
        Some(bytes) => bytes,
        None => return false,
    };
    if decoded[0] != STRKEY_VERSION_ED25519_PUBLIC {
        return false;
    }
    let checksum = crc16_xmodem(&decoded[..33]);
    let expected = u16::from_le_bytes([decoded[33], decoded[34]]);
    checksum == expected
}

/// Verify a TrustlessWork HMAC-SHA256 webhook signature.
/// `payload` is the exact request bytes (Buffer), not a UTF-8 string.
/// Returns true if and only if `payload` signed with `secret` matches `signature`.
fn verify_hmac_signature(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let payload_buf = cx.argument::<JsBuffer>(0)?;
    let signature = cx.argument::<JsString>(1)?.value(&mut cx);
    let secret = cx.argument::<JsString>(2)?.value(&mut cx);
    let payload = payload_buf.as_slice(&cx).to_vec();

    match verify_hmac_sha256(&payload, &signature, secret.as_bytes()) {
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

    const BASE32: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    fn encode_base32(data: &[u8]) -> String {
        let mut bits: u32 = 0;
        let mut nbits: u32 = 0;
        let mut out = String::new();
        for &b in data {
            bits = (bits << 8) | u32::from(b);
            nbits += 8;
            while nbits >= 5 {
                nbits -= 5;
                out.push(BASE32[((bits >> nbits) & 31) as usize] as char);
            }
        }
        if nbits > 0 {
            out.push(BASE32[((bits << (5 - nbits)) & 31) as usize] as char);
        }
        out
    }

    fn encode_ed25519_strkey(pubkey: &[u8; 32]) -> String {
        let mut payload = [0u8; STRKEY_DECODED_LEN];
        payload[0] = STRKEY_VERSION_ED25519_PUBLIC;
        payload[1..33].copy_from_slice(pubkey);
        let checksum = crc16_xmodem(&payload[..33]).to_le_bytes();
        payload[33] = checksum[0];
        payload[34] = checksum[1];
        encode_base32(&payload)
    }

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
    fn hashes_non_utf8_payload_bytes() {
        let payload = [0xff, 0xfe, 0x00, 0x80];
        let secret = b"dev-secret";
        let signature = sign(&payload, secret);
        assert_eq!(verify_hmac_sha256(&payload, &signature, secret), Ok(true));
    }

    #[test]
    fn valid_stellar_g_address() {
        let address = encode_ed25519_strkey(&[0u8; 32]);
        assert_eq!(address.len(), 56);
        assert!(address.starts_with('G'));
        assert!(is_valid_stellar_address(&address));
        assert!(is_valid_stellar_address(
            "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
        ));
    }

    #[test]
    fn invalid_stellar_addresses() {
        let valid = encode_ed25519_strkey(&[0u8; 32]);

        assert!(!is_valid_stellar_address(""));
        assert!(!is_valid_stellar_address("not-an-address"));
        assert!(!is_valid_stellar_address("GSHORT"));
        assert!(!is_valid_stellar_address(&format!("{valid}EXTRA")));

        // Invalid Base32 characters (0, 1, 8, 9 are outside A-Z2-7).
        let mut invalid_base32 = valid.clone();
        invalid_base32.replace_range(8..9, "0");
        assert!(!is_valid_stellar_address(&invalid_base32));

        // Lowercase is rejected even when otherwise well-formed.
        assert!(!is_valid_stellar_address(&valid.to_ascii_lowercase()));

        // 56-character address with a flipped CRC16 checksum.
        let mut invalid_checksum = [0u8; STRKEY_DECODED_LEN];
        invalid_checksum[0] = STRKEY_VERSION_ED25519_PUBLIC;
        let checksum = crc16_xmodem(&invalid_checksum[..33]).wrapping_add(1);
        let checksum_bytes = checksum.to_le_bytes();
        invalid_checksum[33] = checksum_bytes[0];
        invalid_checksum[34] = checksum_bytes[1];
        let invalid_checksum_address = encode_base32(&invalid_checksum);
        assert_eq!(invalid_checksum_address.len(), 56);
        assert!(!is_valid_stellar_address(&invalid_checksum_address));

        // Wrong version byte (not 0x30) with a valid checksum.
        let mut wrong_version = [0u8; STRKEY_DECODED_LEN];
        wrong_version[0] = 0x00;
        let checksum = crc16_xmodem(&wrong_version[..33]).to_le_bytes();
        wrong_version[33] = checksum[0];
        wrong_version[34] = checksum[1];
        assert!(!is_valid_stellar_address(&encode_base32(&wrong_version)));
    }
}
