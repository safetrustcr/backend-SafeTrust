# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

# Rust toolchain for the x402-processor Neon addon.
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

# 4. Build the x402-processor Neon addon and compile TypeScript. See
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
# x402 payment validation is opt-in at runtime but required by the enabled
# integration tests. It is the only remaining native addon; it is placed at
# /app/crates/… so `require('../../../crates/x402-processor')` from
# dist/middleware resolves correctly.
COPY --from=builder /app/crates/x402-processor/index.node /app/crates/x402-processor/index.node
COPY --from=builder /app/crates/x402-processor/package.json /app/crates/x402-processor/package.json

# node user/group already exists in the official Node image.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health/live || exit 1

CMD ["node", "dist/index.js"]
