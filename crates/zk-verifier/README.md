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

The verifier supports ZK and plain UltraHonk proofs using the Keccak transcript.
Generate compatible artifacts with `bb prove -t evm ... --write_vk` (or
`-t evm-no-zk` for a plain proof). Malformed or invalid input returns `false`.

Set `ZK_PROOF_OF_FUNDS_VK_SHA256` on the webhook to the SHA-256 digest of the
raw `vk` file in production. This pins verification to the SafeTrust circuit.

Verify binary artifacts directly while developing with:

```sh
cargo run -p zk-verifier --example verify_artifacts -- proof vk 1000000000 BALANCE_COMMITMENT_HEX
```

After `npm run build:rust` (from `webhook/`), exercise the exported Node API:

```sh
node crates/zk-verifier/examples/verify-artifacts.js proof vk 1000000000 BALANCE_COMMITMENT_HEX
```
