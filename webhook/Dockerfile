# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

# Rust toolchain for the default-enabled Neon addons.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Build context is the repo root, so source paths are repo-root relative.
WORKDIR /app

# 1. Node dependencies first (cached until package.json changes).
COPY webhook/package*.json ./webhook/
RUN cd webhook && npm ci

# 2. Rust workspace: root manifest + lockfile + crate members at /app so
#    `cargo build --manifest-path ../crates/Cargo.toml` resolves from webhook.
COPY crates/ ./crates/
COPY tsconfig.crates.json ./

# 3. TypeScript sources + config.
COPY webhook/tsconfig.json ./webhook/
COPY webhook/src/ ./webhook/src/

# 4. Build the default-enabled Neon addons and compile TypeScript. See
#    webhook/package.json "build" script.
RUN cd webhook && npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS production

WORKDIR /app/webhook

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY webhook/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/webhook/dist ./dist
COPY --from=builder /app/crates/webhook-verifier/index.node /app/crates/webhook-verifier/index.node
COPY --from=builder /app/crates/webhook-verifier/index.js /app/crates/webhook-verifier/index.js
COPY --from=builder /app/crates/webhook-verifier/fallback.js /app/crates/webhook-verifier/fallback.js
COPY --from=builder /app/crates/webhook-verifier/package.json /app/crates/webhook-verifier/package.json
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
# escrow-state-machine: compile-time SafeTrust escrow lifecycle.
COPY --from=builder /app/crates/escrow-state-machine/index.node /app/crates/escrow-state-machine/index.node
COPY --from=builder /app/crates/escrow-state-machine/package.json /app/crates/escrow-state-machine/package.json
COPY --from=builder /app/crates/escrow-state-machine/index.d.ts /app/crates/escrow-state-machine/index.d.ts
# x402 payment validation is opt-in at runtime but required by the enabled integration tests.
COPY --from=builder /app/crates/x402-processor/index.node /app/crates/x402-processor/index.node
COPY --from=builder /app/crates/x402-processor/package.json /app/crates/x402-processor/package.json

# node user/group already exists in the official Node image.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
