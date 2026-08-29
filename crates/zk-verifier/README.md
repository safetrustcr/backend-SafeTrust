# zk-verifier

Rust/Neon verifier for SafeTrust proof-of-funds proofs.

`verifyProofOfFunds(proofHex, verificationKeyHex, thresholdStroops,
balanceCommitmentHex)` accepts the hex encoding of the binary `proof` and `vk`
artifacts emitted by Barretenberg, the public threshold as a decimal `u64`
stroop string, and the public balance commitment as a 32-byte field hex string.

The verifier constructs the corrected `proof_of_funds` circuit ABI in order:

1. `threshold: pub u64`
2. `balance_commitment: pub Field` (the circuit's public return value)

The initialize webhook accepts these values as `zk_threshold_stroops` and
`zk_balance_commitment`. It converts the escrow `amount` to stroops itself and
rejects the proof when that value differs from `zk_threshold_stroops`.

The verifier supports ZK UltraHonk proofs using the Keccak transcript. Generate
compatible artifacts with `bb prove -t evm ... --write_vk`. Malformed or invalid
input returns `false`.

Verification is pinned to Barretenberg `5.0.0-nightly.20260522`, matching the
SafeTrust ZK SDK. `npm run build:rust` downloads the matching platform binary,
verifies its release SHA-256 digest, and packages it beside the Neon addon.
Set `ZK_BB_BINARY` only when intentionally overriding that binary during local
development.

On Windows, this Barretenberg release cannot safely read arbitrary binary proof
files because its file streams use text mode. The addon transparently supplies
equivalent JSON artifacts instead. The CLI may download its circuit-sized CRS on
first use; set `ZK_BB_CRS_PATH` to control the persistent cache directory. Linux
and macOS use Barretenberg's structured API and do not need that CLI CRS path.

Set `ZK_PROOF_OF_FUNDS_VK_SHA256` on the webhook to the SHA-256 digest of the
raw `vk` file in production. This pins verification to the SafeTrust circuit.

Verify binary artifacts directly while developing with:

```sh
cargo run -p zk-verifier --example verify_artifacts -- proof vk 1000000000 BALANCE_COMMITMENT_HEX
```

After `npm run build:rust` (from `webhook/`), exercise the exported Node API:

```sh
cd .. && node crates/zk-verifier/examples/verify-artifacts.js proof vk 1000000000 BALANCE_COMMITMENT_HEX
```
