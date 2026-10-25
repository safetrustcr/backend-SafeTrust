use neon::prelude::*;
#[cfg(windows)]
use serde_json::{json, Value};
use std::env;
#[cfg(windows)]
use std::fs::{self, File};
#[cfg(windows)]
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
#[cfg(windows)]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(not(windows))]
use barretenberg_rs::{
    backends::PipeBackend, generated_types::ProofSystemSettings, BarretenbergApi,
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::path::Path;

const MAX_PROOF_BYTES: usize = 1024 * 1024;
const MAX_VERIFICATION_KEY_BYTES: usize = 128 * 1024;
const FIELD_SIZE: usize = 32;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
type PublicInput = [u8; FIELD_SIZE];
const BN254_SCALAR_MODULUS: PublicInput = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecodeError {
    Empty,
    InvalidHex,
    InvalidThreshold,
    InvalidFieldSize,
    NonCanonicalField,
    TooLarge,
}

fn decode_hex(value: &str, max_bytes: usize) -> Result<Vec<u8>, DecodeError> {
    let value = value.strip_prefix("0x").unwrap_or(value);
    if value.is_empty() {
        return Err(DecodeError::Empty);
    }
    if value.len() > max_bytes.saturating_mul(2) {
        return Err(DecodeError::TooLarge);
    }
    hex::decode(value).map_err(|_| DecodeError::InvalidHex)
}

fn encode_threshold(threshold_stroops: &str) -> Result<PublicInput, DecodeError> {
    if threshold_stroops.is_empty() || !threshold_stroops.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(DecodeError::InvalidThreshold);
    }

    let threshold = threshold_stroops
        .parse::<u64>()
        .map_err(|_| DecodeError::InvalidThreshold)?;
    let mut encoded = [0_u8; FIELD_SIZE];
    encoded[FIELD_SIZE - 8..].copy_from_slice(&threshold.to_be_bytes());
    Ok(encoded)
}

fn decode_balance_commitment(value: &str) -> Result<PublicInput, DecodeError> {
    let bytes = decode_hex(value, FIELD_SIZE)?;
    let commitment: PublicInput = bytes
        .try_into()
        .map_err(|_| DecodeError::InvalidFieldSize)?;
    if commitment >= BN254_SCALAR_MODULUS {
        return Err(DecodeError::NonCanonicalField);
    }
    Ok(commitment)
}

fn bb_binary_path() -> PathBuf {
    env::var_os("ZK_BB_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(if cfg!(windows) {
                "bb.exe"
            } else {
                "bb"
            })
        })
}

#[allow(clippy::manual_is_multiple_of)] // Keep compatibility with Rust 1.86 used by Noir tooling.
fn split_fields(bytes: &[u8]) -> Option<Vec<Vec<u8>>> {
    if bytes.is_empty() || bytes.len() % FIELD_SIZE != 0 {
        return None;
    }

    Some(bytes.chunks_exact(FIELD_SIZE).map(<[u8]>::to_vec).collect())
}

#[cfg(windows)]
struct ArtifactDirectory(PathBuf);

#[cfg(windows)]
impl Drop for ArtifactDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(windows)]
fn create_artifact_directory() -> io::Result<ArtifactDirectory> {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    for _ in 0..16 {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let path = env::temp_dir().join(format!(
            "safetrust-zk-{}-{timestamp}-{id}",
            std::process::id()
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(ArtifactDirectory(path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a private artifact directory",
    ))
}

#[cfg(windows)]
fn write_fields_json(path: &Path, property: &str, fields: &[Vec<u8>]) -> io::Result<()> {
    let encoded = fields
        .iter()
        .map(|field| format!("0x{}", hex::encode(field)))
        .collect::<Vec<_>>();
    let mut object = serde_json::Map::new();
    object.insert(property.to_owned(), json!(encoded));
    serde_json::to_writer(File::create(path)?, &Value::Object(object))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(windows)]
fn verify_ultrahonk(
    verification_key: &[u8],
    public_inputs: &[PublicInput],
    proof: Vec<Vec<u8>>,
) -> Result<bool, String> {
    let verification_key = match split_fields(verification_key) {
        Some(fields) => fields,
        None => return Ok(false),
    };
    let public_inputs = public_inputs
        .iter()
        .map(|input| input.to_vec())
        .collect::<Vec<_>>();
    let artifacts = create_artifact_directory()
        .map_err(|error| format!("could not create temporary artifact directory: {error}"))?;
    let proof_path = artifacts.0.join("proof.json");
    let key_path = artifacts.0.join("vk.json");
    let inputs_path = artifacts.0.join("public_inputs.json");
    write_fields_json(&proof_path, "proof", &proof)
        .map_err(|error| format!("could not write proof JSON artifact: {error}"))?;
    write_fields_json(&key_path, "vk", &verification_key)
        .map_err(|error| format!("could not write vk JSON artifact: {error}"))?;
    write_fields_json(&inputs_path, "public_inputs", &public_inputs)
        .map_err(|error| format!("could not write public_inputs JSON artifact: {error}"))?;

    let binary = bb_binary_path();
    let mut command = Command::new(&binary);
    command
        .arg("verify")
        .arg("--proof_path")
        .arg(proof_path)
        .arg("--vk_path")
        .arg(key_path)
        .arg("--public_inputs_path")
        .arg(inputs_path)
        .arg("--verifier_target")
        .arg("evm")
        .env("HARDWARE_CONCURRENCY", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let crs_path = env::var_os("ZK_BB_CRS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("crs"));
    fs::create_dir_all(&crs_path)
        .map_err(|error| format!("could not create CRS directory {}: {error}", crs_path.display()))?;
    command.arg("--crs_path").arg(crs_path);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("could not execute bb binary at {}: {error}", binary.display()))?;

    Ok(output.status.success())
}

#[cfg(not(windows))]
fn verify_ultrahonk(
    verification_key: &[u8],
    public_inputs: &[PublicInput],
    proof: Vec<Vec<u8>>,
) -> Result<bool, String> {
    let backend = PipeBackend::new(bb_binary_path(), Some(1))
        .map_err(|error| format!("could not start the bb backend: {error}"))?;
    let mut api = BarretenbergApi::new(backend);
    let settings = ProofSystemSettings {
        ipa_accumulation: false,
        oracle_hash_type: "keccak".to_owned(),
        disable_zk: false,
        optimized_solidity_verifier: false,
    };
    let inputs = public_inputs.iter().map(|input| input.to_vec()).collect();
    let verified = api
        .circuit_verify(verification_key, inputs, proof, settings)
        .map(|response| response.verified)
        .map_err(|error| format!("circuit verification failed: {error}"));
    let _ = api.destroy();
    verified
}

/// Verify a Keccak/EVM UltraHonk proof generated by Noir's `bb` backend.
///
/// Public inputs are constructed in the circuit ABI order from an unsigned
/// 64-bit threshold in stroops and a 32-byte balance commitment. The ZK proof
/// is verified by the exact Barretenberg version used by SafeTrust's Noir
/// toolchain. Decoding or verification failure returns `Ok(false)`;
/// backend startup or transport errors return `Err`.
pub fn verify_proof_of_funds_hex(
    proof_hex: &str,
    verification_key_hex: &str,
    threshold_stroops: &str,
    balance_commitment_hex: &str,
) -> Result<bool, String> {
    let proof_bytes = match decode_hex(proof_hex, MAX_PROOF_BYTES) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(false),
    };
    let verification_key = match decode_hex(verification_key_hex, MAX_VERIFICATION_KEY_BYTES) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(false),
    };
    let threshold = match encode_threshold(threshold_stroops) {
        Ok(input) => input,
        Err(_) => return Ok(false),
    };
    let balance_commitment = match decode_balance_commitment(balance_commitment_hex) {
        Ok(input) => input,
        Err(_) => return Ok(false),
    };
    let public_inputs = [threshold, balance_commitment];
    let proof = match split_fields(&proof_bytes) {
        Some(fields) => fields,
        None => return Ok(false),
    };

    catch_unwind(AssertUnwindSafe(|| {
        verify_ultrahonk(&verification_key, &public_inputs, proof)
    }))
    .unwrap_or_else(|_| Err("backend panicked during verification".to_string()))
}

fn verify_proof_of_funds(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let proof_hex = cx.argument::<JsString>(0)?.value(&mut cx);
    let verification_key = cx.argument::<JsString>(1)?.value(&mut cx);
    let threshold_stroops = cx.argument::<JsString>(2)?.value(&mut cx);
    let balance_commitment = cx.argument::<JsString>(3)?.value(&mut cx);

    match verify_proof_of_funds_hex(
        &proof_hex,
        &verification_key,
        &threshold_stroops,
        &balance_commitment,
    ) {
        Ok(is_valid) => Ok(cx.boolean(is_valid)),
        Err(err) => cx.throw_error(err),
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("verifyProofOfFunds", verify_proof_of_funds)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_hex() {
        let commitment = "00".repeat(FIELD_SIZE);
        assert_eq!(
            verify_proof_of_funds_hex("not-hex", "00", "1", &commitment),
            Ok(false)
        );
        assert_eq!(
            verify_proof_of_funds_hex("00", "not-hex", "1", &commitment),
            Ok(false)
        );
        assert_eq!(
            verify_proof_of_funds_hex("00", "00", "1", "xyz"),
            Ok(false)
        );
    }

    #[test]
    fn rejects_empty_proof_and_key() {
        let commitment = "00".repeat(FIELD_SIZE);
        assert_eq!(
            verify_proof_of_funds_hex("", "00", "1", &commitment),
            Ok(false)
        );
        assert_eq!(
            verify_proof_of_funds_hex("00", "", "1", &commitment),
            Ok(false)
        );
    }

    #[test]
    fn accepts_0x_prefix_when_decoding() {
        assert_eq!(decode_hex("0x00ff", 2), Ok(vec![0, 255]));
    }

    #[test]
    fn encodes_threshold_as_a_32_byte_public_field() {
        let threshold = 10_000_000_000_u64;
        let encoded = encode_threshold(&threshold.to_string()).unwrap();

        assert_eq!(&encoded[..FIELD_SIZE - 8], &[0_u8; FIELD_SIZE - 8]);
        assert_eq!(&encoded[FIELD_SIZE - 8..], &threshold.to_be_bytes());
    }

    #[test]
    fn rejects_invalid_or_out_of_range_thresholds() {
        assert_eq!(encode_threshold("-1"), Err(DecodeError::InvalidThreshold));
        assert_eq!(encode_threshold("1.0"), Err(DecodeError::InvalidThreshold));
        assert_eq!(
            encode_threshold("18446744073709551616"),
            Err(DecodeError::InvalidThreshold)
        );
    }

    #[test]
    fn requires_a_32_byte_balance_commitment() {
        let commitment = "2a".repeat(FIELD_SIZE);
        assert_eq!(
            decode_balance_commitment(&commitment),
            Ok([0x2a; FIELD_SIZE])
        );
        assert_eq!(
            decode_balance_commitment("ab"),
            Err(DecodeError::InvalidFieldSize)
        );
        assert_eq!(
            decode_balance_commitment(&hex::encode(BN254_SCALAR_MODULUS)),
            Err(DecodeError::NonCanonicalField)
        );
    }

    #[test]
    fn enforces_input_size_limits_before_allocation() {
        let oversized = "00".repeat(MAX_PROOF_BYTES + 1);
        assert_eq!(
            decode_hex(&oversized, MAX_PROOF_BYTES),
            Err(DecodeError::TooLarge)
        );
    }

    #[test]
    fn proof_must_be_an_exact_sequence_of_fields() {
        assert_eq!(split_fields(&[]), None);
        assert_eq!(split_fields(&[0_u8; FIELD_SIZE - 1]), None);
        assert_eq!(split_fields(&[0_u8; FIELD_SIZE]).unwrap().len(), 1);
    }
}
