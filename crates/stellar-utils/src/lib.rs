//! stellar-utils — Rust-native Stellar utilities for SafeTrust.
//!
//! Exposes two functions to Node.js via Neon (Node-API):
//!   - `validateStellarAddress(address) -> boolean`
//!   - `verifyStellarEd25519(message, signatureHex, publicKey) -> boolean`
//!
//! The pure logic lives in [`is_valid_stellar_address`] / [`verify_ed25519`] so
//! it can be unit-tested with `cargo test` without a Node.js runtime. The Neon
//! wrappers below are thin and contain no business logic.

use neon::prelude::*;
use stellar_strkey::Strkey;

/// Validate a Stellar account address (G… strkey).
///
/// Returns `true` only for a well-formed Ed25519 public-key strkey — i.e. the
/// SEP-23 version byte and checksum both check out AND the payload decodes as
/// an Ed25519 public key. Contract (C…), muxed (M…), pre-auth-tx, hash-x and
/// signed-payload strkeys are rejected, mirroring the previous JS rule that
/// only accepted `G[A-Z2-7]{55}` (a plain `Strkey::from_string(...).is_ok()`
/// would wrongly accept C…/M… strkeys).
pub fn is_valid_stellar_address(address: &str) -> bool {
    matches!(Strkey::from_string(address), Ok(Strkey::PublicKeyEd25519(_)))
}

/// Verify an Ed25519 signature over `message` against the given signer.
///
/// - `message`    — the exact bytes that were signed (JS string → UTF-8).
/// - `signature`  — 64-byte Ed25519 signature, hex-encoded (128 hex chars).
/// - `public_key` — the signer's Stellar account address (G… strkey).
///
/// Returns `false` for any malformed input (bad strkey, non-hex signature,
/// wrong signature length) as well as for a genuinely invalid signature —
/// callers never receive a panic or an exception from this path.
pub fn verify_ed25519(message: &[u8], signature_hex: &str, public_key: &str) -> bool {
    // 1 — Decode the signer's public key from its strkey (checksum-validated).
    let raw_public_key = match Strkey::from_string(public_key) {
        Ok(Strkey::PublicKeyEd25519(pk)) => pk.0,
        _ => return false,
    };

    // 2 — Decode the hex-encoded signature. An Ed25519 signature is 64
    //     bytes, so its hex form must be exactly 128 chars — reject anything
    //     else up front. `Signature::from_slice` below also enforces the
    //     64-byte length as a second line of defense.
    if signature_hex.len() != 128 {
        return false;
    }
    let signature_bytes = match hex::decode(signature_hex) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let signature = match ed25519_dalek::Signature::from_slice(&signature_bytes) {
        Ok(sig) => sig,
        Err(_) => return false,
    };

    // 3 — Build the dalek public key and verify (verify_strict also enforces
    //     the anti-malleability checks, unlike plain `verify`).
    let public_key = match ed25519_dalek::VerifyingKey::from_bytes(&raw_public_key) {
        Ok(pk) => pk,
        Err(_) => return false,
    };

    public_key.verify_strict(message, &signature).is_ok()
}

// ─── Neon exports ─────────────────────────────────────────────────────────────

/// Read the `index`-th argument as a string, or `None` when it is missing,
/// null, undefined, or not a string. The addon never throws — malformed
/// arguments yield `false`, matching the never-throws contract documented in
/// the README for both exported functions.
fn string_argument(cx: &mut FunctionContext, index: i32) -> Option<String> {
    let value = cx.argument_opt(index)?;
    let js_string = value.downcast::<JsString, _>(cx).ok()?;
    Some(js_string.value(cx))
}

fn validate_stellar_address(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let address = match string_argument(&mut cx, 0) {
        Some(address) => address,
        None => return Ok(cx.boolean(false)),
    };
    Ok(cx.boolean(is_valid_stellar_address(&address)))
}

fn verify_stellar_ed25519(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let message = match string_argument(&mut cx, 0) {
        Some(message) => message,
        None => return Ok(cx.boolean(false)),
    };
    let signature = match string_argument(&mut cx, 1) {
        Some(signature) => signature,
        None => return Ok(cx.boolean(false)),
    };
    let public_key = match string_argument(&mut cx, 2) {
        Some(public_key) => public_key,
        None => return Ok(cx.boolean(false)),
    };

    let result = verify_ed25519(message.as_bytes(), &signature, &public_key);
    Ok(cx.boolean(result))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("validateStellarAddress", validate_stellar_address)?;
    cx.export_function("verifyStellarEd25519",   verify_stellar_ed25519)?;
    Ok(())
}

// ─── Unit tests (`cargo test`) ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Real, checksum-valid Stellar account used by the Karate
    /// sync-wallet tests (see tests/karate/features/auth/sync-wallet.feature).
    /// NOTE: the old "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z"
    /// fixture was fabricated (bad checksum) and is rejected here on purpose.
    const KNOWN_GOOD_ADDRESS: &str =
        "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

    /// Deterministic signing key (no RNG needed) built from a fixed seed.
    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn address_of(sk: &SigningKey) -> String {
        Strkey::PublicKeyEd25519(stellar_strkey::ed25519::PublicKey(
            sk.verifying_key().to_bytes(),
        ))
        .to_string()
    }

    #[test]
    fn known_good_address_is_valid() {
        assert!(is_valid_stellar_address(KNOWN_GOOD_ADDRESS));
        // The Karate fixture must equal the strkey of a fixed keypair, so it
        // is verifiably real (canonically encoded by stellar-strkey itself).
        assert_eq!(KNOWN_GOOD_ADDRESS, address_of(&signing_key()));
    }

    #[test]
    fn rejects_malformed_addresses() {
        assert!(!is_valid_stellar_address(""));
        assert!(!is_valid_stellar_address("not-a-stellar-address"));
        // 55 chars (one short) — the old JS regex also rejects this.
        assert!(!is_valid_stellar_address(
            "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7"
        ));
        // Lowercase is not valid base32 (base32 alphabet is A-Z and 2-7).
        assert!(!is_valid_stellar_address(
            "gDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z"
        ));
        // Valid alphabet/length but wrong checksum.
        assert!(!is_valid_stellar_address(
            "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J70"
        ));
    }

    #[test]
    fn rejects_contract_strkeys() {
        // Build a *valid* contract (C…) strkey — it must still be rejected,
        // because only Ed25519 public-key strkeys are account addresses.
        let contract = Strkey::Contract(stellar_strkey::Contract([0u8; 32])).to_string();
        assert!(contract.starts_with('C'));
        assert!(!is_valid_stellar_address(&contract));
    }

    #[test]
    fn verifies_signature_over_message() {
        let key = signing_key();
        let address = address_of(&key);
        assert!(is_valid_stellar_address(&address));

        let message = b"Hello, SafeTrust!";
        let signature_hex = hex::encode(key.sign(message).to_bytes());

        assert!(verify_ed25519(message, &signature_hex, &address));
    }

    #[test]
    fn rejects_tampered_message() {
        let key = signing_key();
        let address = address_of(&key);

        let signature_hex = hex::encode(key.sign(b"original message").to_bytes());

        assert!(!verify_ed25519(b"tampered message", &signature_hex, &address));
    }

    #[test]
    fn rejects_signature_from_another_key() {
        let key = signing_key();
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let other_address = address_of(&other);

        let message = b"message";
        let signature_hex = hex::encode(key.sign(message).to_bytes());

        assert!(!verify_ed25519(message, &signature_hex, &other_address));
    }

    #[test]
    fn rejects_malformed_signature_inputs() {
        let key = signing_key();
        let address = address_of(&key);
        let valid_sig = hex::encode(key.sign(b"x").to_bytes());

        assert!(!verify_ed25519(b"message", "not-hex", &address));
        assert!(!verify_ed25519(b"message", "abcd", &address)); // wrong length
        assert!(!verify_ed25519(b"message", &valid_sig, "not-a-valid-strkey"));

        // A contract strkey is not an account — verification must fail.
        let contract = Strkey::Contract(stellar_strkey::Contract([0u8; 32])).to_string();
        assert!(!verify_ed25519(b"message", &valid_sig, &contract));
    }
}
