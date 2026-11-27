# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Base images are pinned by digest; the tag in the comment is what Dependabot tracks.
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS builder # 25-bookworm-slim

# Rust toolchain for the Neon addons (webhook-verifier, zk-verifier,
# stellar-utils, chunk-processor, pg-bulk-upsert, x402-processor), plus a glibc
# runtime for the pinned Barretenberg binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# security-reviewed: official rustup installer until #756 removes Rust crates
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Build context is the repo root, so source paths are repo-root relative.
WORKDIR /app

# 1. Node dependencies first (cached until package.json changes).
COPY webhook/package*.json ./webhook/
RUN cd webhook && npm ci --ignore-scripts

# 2. Rust workspace: root manifest + lockfile + all member crates at /app so
#    `cargo build --workspace --manifest-path ../crates/Cargo.toml` resolves from webhook.
COPY crates/ ./crates/
COPY tsconfig.crates.json ./

# 3. TypeScript sources + config.
COPY webhook/tsconfig.json ./webhook/
COPY webhook/src/ ./webhook/src/

# 4. Build the Neon addons (cargo --workspace → each crate's copy-native.js) and
#    compile TypeScript. See webhook/package.json "build" script.
RUN cd webhook && npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS production # 25-bookworm-slim

WORKDIR /app/webhook

# No extra binaries: the health check below uses Node's built-in fetch. The
# base image ships curl, so remove it — nothing in the runtime needs it and it
# is one more download tool an attacker could use.
RUN if dpkg -s curl >/dev/null 2>&1; then \
        apt-get purge -y curl \
        && rm -rf /var/lib/apt/lists/* \
    ; fi

COPY webhook/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/webhook/dist ./dist
COPY --from=builder /app/crates/webhook-verifier/index.node /app/crates/webhook-verifier/index.node
COPY --from=builder /app/crates/webhook-verifier/index.js /app/crates/webhook-verifier/index.js
COPY --from=builder /app/crates/webhook-verifier/fallback.js /app/crates/webhook-verifier/fallback.js
COPY --from=builder /app/crates/webhook-verifier/package.json /app/crates/webhook-verifier/package.json
COPY --from=builder /app/crates/zk-verifier/index.node /app/crates/zk-verifier/index.node
COPY --from=builder /app/crates/zk-verifier/package.json /app/crates/zk-verifier/package.json
COPY --from=builder /app/crates/zk-verifier/index.d.ts /app/crates/zk-verifier/index.d.ts
COPY --from=builder /app/crates/zk-verifier/bb /app/crates/zk-verifier/bb
RUN chmod 0755 /app/crates/zk-verifier/bb
# Runtime pieces of the stellar-utils addon (package.json → main: native/index.node).
# Placed at /app/crates/… so `require('../../../../crates/stellar-utils')` from
# dist/routes/auth resolves correctly.
COPY --from=builder /app/crates/stellar-utils/package.json /app/crates/stellar-utils/package.json
COPY --from=builder /app/crates/stellar-utils/native /app/crates/stellar-utils/native
# chunk-processor: parallel escrow-chunk fetcher (built by build:rust --workspace).
COPY --from=builder /app/crates/chunk-processor/index.node /app/crates/chunk-processor/index.node
COPY --from=builder /app/crates/chunk-processor/package.json /app/crates/chunk-processor/package.json
# pg-bulk-upsert: single-statement escrow UPSERT (built by build:rust --workspace).
COPY --from=builder /app/crates/pg-bulk-upsert/index.node /app/crates/pg-bulk-upsert/index.node
COPY --from=builder /app/crates/pg-bulk-upsert/package.json /app/crates/pg-bulk-upsert/package.json
# soroban-reconciler: reconcile escrow state.
COPY --from=builder /app/crates/soroban-reconciler/package.json /app/crates/soroban-reconciler/package.json
COPY --from=builder /app/crates/soroban-reconciler/native /app/crates/soroban-reconciler/native
# x402-processor: x402 payment protocol verifier (built by build:rust --workspace).
COPY --from=builder /app/crates/x402-processor/index.node /app/crates/x402-processor/index.node
COPY --from=builder /app/crates/x402-processor/package.json /app/crates/x402-processor/package.json
# escrow-state-machine: compile-time SafeTrust escrow lifecycle (built by build:rust --workspace).
COPY --from=builder /app/crates/escrow-state-machine/index.node /app/crates/escrow-state-machine/index.node
COPY --from=builder /app/crates/escrow-state-machine/package.json /app/crates/escrow-state-machine/package.json
COPY --from=builder /app/crates/escrow-state-machine/index.d.ts /app/crates/escrow-state-machine/index.d.ts

# node user/group already exists in the official Node image.
USER node

# One port definition for the image, Compose and the health check. Compose
# publishes this on 127.0.0.1 and sets PORT to the matching container port.
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

# Node instead of curl: the production image has no curl.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "dist/index.js"]
