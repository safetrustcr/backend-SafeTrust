use std::{env, fs, process};
use zk_verifier::verify_proof_of_funds_hex;

fn main() {
    let paths: Vec<_> = env::args_os().skip(1).collect();
    if paths.len() != 3 {
        eprintln!("usage: verify_artifacts <proof> <vk> <public_inputs>");
        process::exit(2);
    }

    let read_hex = |path: &std::ffi::OsString| match fs::read(path) {
        Ok(bytes) => hex::encode(bytes),
        Err(error) => {
            eprintln!("failed to read {}: {error}", path.to_string_lossy());
            process::exit(2);
        }
    };

    let is_valid = verify_proof_of_funds_hex(
        &read_hex(&paths[0]),
        &read_hex(&paths[1]),
        &read_hex(&paths[2]),
    );

    println!("{}", if is_valid { "valid" } else { "invalid" });
    if !is_valid {
        process::exit(1);
    }
}
