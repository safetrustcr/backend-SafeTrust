use std::{env, fs, process};
use zk_verifier::verify_proof_of_funds_hex;

fn main() {
    let paths: Vec<_> = env::args_os().skip(1).collect();
    if paths.len() != 4 {
        eprintln!(
            "usage: verify_artifacts <proof> <vk> <threshold_stroops> <balance_commitment_hex>"
        );
        process::exit(2);
    }

    let read_hex = |path: &std::ffi::OsString| match fs::read(path) {
        Ok(bytes) => hex::encode(bytes),
        Err(error) => {
            eprintln!("failed to read {}: {error}", path.to_string_lossy());
            process::exit(2);
        }
    };

    let threshold_stroops = paths[2].to_string_lossy();
    let balance_commitment = paths[3].to_string_lossy();
    let is_valid = match verify_proof_of_funds_hex(
        &read_hex(&paths[0]),
        &read_hex(&paths[1]),
        &threshold_stroops,
        &balance_commitment,
    ) {
        Ok(valid) => valid,
        Err(error) => {
            eprintln!("verification error: {error}");
            process::exit(1);
        }
    };

    println!("{}", if is_valid { "valid" } else { "invalid" });
    if !is_valid {
        process::exit(1);
    }
}
