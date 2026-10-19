# Native crate build gates

The default Cargo workspace build includes only crates used by the safe startup
path. `zk-verifier`, `x402-processor`, and `soroban-reconciler` remain workspace
members so they can be built deliberately, but are excluded from
`default-members` and from the default webhook build and image.

The workspace root package in `crates/Cargo.toml` owns the opt-in feature map
and its optional path dependencies:

| Crate | Cargo feature | Prerequisite before enabling |
|---|---|---|
| `zk-verifier` | `zk-verifier` | Close ESC-05: wire the experimental feature flag and require a pinned verification key in the TypeScript consumer. |
| `x402-processor` | `x402-processor` | Close ESC-05: resolve the payment-flow gaps and wire the experimental feature flag. |
| `soroban-reconciler` | `soroban-reconciler` | Close ESC-02: establish an authoritative on-chain state source. |

Each feature activates the corresponding `optional = true` path dependency.
For example, explicitly include one crate in the build graph with:

```sh
cargo build --manifest-path crates/Cargo.toml \
  -p safetrust-native-gates --features x402-processor
```

To produce a Neon addon artifact for an explicitly approved deployment, build
with the opted-in feature and run that crate's `copy-native.js` script. This is
intentionally not part of `npm run build:rust`; nor should it be enabled before
its prerequisite issue is closed. `soroban-reconciler` also retains its separate
compile-time `unvalidated-reader` and runtime
`SOROBAN_RECONCILER_ALLOW_UNVALIDATED=true` safeguards.

## Missing native modules

Node's Neon package loader resolves the package's configured entry point
(`index.node` or `native/index.node`) through ordinary `require()`. When the
crate is excluded, the artifact is absent and Node throws (normally
`MODULE_NOT_FOUND`). The TypeScript consumers catch that load failure,
log the unavailable addon, and take their existing fail-closed/fallback path:
ZK proof requests fail closed, x402 payment validation fails closed without
the validator, and Soroban reconciliation skips unavailable native work. The
`webhook-verifier`, `stellar-utils`, and `escrow-state-machine` crates are not
gated or otherwise changed; their active consumers remain on the default
build path.
