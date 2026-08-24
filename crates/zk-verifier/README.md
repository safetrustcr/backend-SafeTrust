# zk-verifier

Rust/Neon verifier for SafeTrust proof-of-funds proofs.

`verifyProofOfFunds(proofHex, verificationKeyHex, publicInputsHex)` accepts the
hex encoding of the binary `proof`, `vk`, and `public_inputs` artifacts emitted
by Barretenberg. Public inputs are concatenated 32-byte field elements; use an
empty string when the circuit has no public inputs.

The verifier supports ZK and plain UltraHonk proofs using the Keccak transcript.
Generate compatible artifacts with `bb prove -t evm ... --write_vk` (or
`-t evm-no-zk` for a plain proof). Malformed or invalid input returns `false`.

Set `ZK_PROOF_OF_FUNDS_VK_SHA256` on the webhook to the SHA-256 digest of the
raw `vk` file in production. This pins verification to the SafeTrust circuit.

Verify binary artifacts directly while developing with:

```sh
cargo run -p zk-verifier --example verify_artifacts -- proof vk public_inputs
```

After `npm run build:rust` (from `webhook/`), exercise the exported Node API:

```sh
node crates/zk-verifier/examples/verify-artifacts.js proof vk public_inputs
```
