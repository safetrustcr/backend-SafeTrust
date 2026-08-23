# stellar-utils 🪐

Rust-native Stellar utilities for SafeTrust, exposed to Node.js via **Neon** (Node-API).

## What it provides

| JS export                  | Signature                                   | Notes |
| -------------------------- | ------------------------------------------- | ----- |
| `validateStellarAddress`   | `(address: string) => boolean`              | Checks the SEP-23 version byte + checksum AND that the strkey is an Ed25519 public key (`G…`). Rejects `C…`/`M…` and other strkey types. |
| `verifyStellarEd25519`     | `(message: string, signatureHex: string, publicKey: string) => boolean` | Verifies a 64-byte Ed25519 signature (hex-encoded) over the message (UTF-8) against a `G…` signer address. Uses `verify_strict` (anti-malleability). Never throws — returns `false` on malformed input. |

## Build

Prerequisites: Rust toolchain (`cargo`). The crate targets Node-API v6, which is
ABI-stable across Node.js versions — no per-Node rebuilds.

```bash
# From the repo root (workspace build — builds both crates, shared target/ + Cargo.lock):
cargo build --release --workspace
node crates/stellar-utils/copy-native.js   # → native/index.node (handles .so/.dylib/.dll naming)

# Or from webhook/: builds the whole workspace and copies both addons
npm run build:rust
```

The Docker image builds the addon automatically via the workspace
(see `webhook/Dockerfile`) and ships `native/index.node` into the production stage.

## Consuming from the webhook

```js
const { validateStellarAddress } = require('../../../../crates/stellar-utils');
```

`sync-wallet.handler.js` uses this for Stellar address validation, falling back
to the previous JS regex only if the native addon is unavailable.

## Test

```bash
cargo test      # pure-logic unit tests (no Node.js needed)
```
