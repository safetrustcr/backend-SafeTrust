# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Rust toolchain for the Neon addons (webhook-verifier, stellar-utils,
# chunk-processor). gcc + musl-dev provide the C linker and musl headers rustc
# needs on Alpine.
RUN apk add --no-cache curl build-base rust cargo gcc musl-dev

# Build context is the repo root, so source paths are repo-root relative.
WORKDIR /app

# 1. Node dependencies first (cached until package.json changes).
COPY webhook/package*.json ./webhook/
RUN cd webhook && npm ci

# 2. Rust workspace: root manifest + lockfile + all member crates at /app so
#    `cargo build --workspace --manifest-path ../Cargo.toml` resolves from webhook.
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/

# 3. TypeScript sources + config.
COPY webhook/tsconfig.json ./webhook/
COPY webhook/src/ ./webhook/src/

# 4. Build the Neon addons (cargo --workspace → each crate's copy-native.js) and
#    compile TypeScript. See webhook/package.json "build" script.
RUN cd webhook && npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:24-alpine AS production

WORKDIR /app/webhook

RUN apk add --no-cache curl

COPY webhook/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/webhook/dist ./dist
COPY --from=builder /app/crates/webhook-verifier/index.node /app/crates/webhook-verifier/index.node
COPY --from=builder /app/crates/webhook-verifier/package.json /app/crates/webhook-verifier/package.json
# Runtime pieces of the stellar-utils addon (package.json → main: native/index.node).
# Placed at /app/crates/… so `require('../../../../crates/stellar-utils')` from
# dist/routes/auth resolves correctly.
COPY --from=builder /app/crates/stellar-utils/package.json /app/crates/stellar-utils/package.json
COPY --from=builder /app/crates/stellar-utils/native /app/crates/stellar-utils/native
# chunk-processor: parallel escrow-chunk fetcher (built by build:rust --workspace).
COPY --from=builder /app/crates/chunk-processor/index.node /app/crates/chunk-processor/index.node
COPY --from=builder /app/crates/chunk-processor/package.json /app/crates/chunk-processor/package.json

# node user/group already exists in official node:24-alpine image
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
