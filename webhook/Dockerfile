# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Rust toolchain for the Neon addons.
# gcc + musl-dev provide the C linker and musl headers rustc needs on Alpine.
RUN apk add --no-cache curl build-base rust cargo gcc musl-dev

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY webhook/package*.json ./webhook/
WORKDIR /app/webhook
RUN npm ci

COPY webhook/tsconfig.json ./

# Build the Rust crate → native/index.node (Node-API v6, ABI-stable).
COPY webhook/src/ ./src/
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:24-alpine AS production

WORKDIR /app/webhook

RUN apk add --no-cache curl

COPY webhook/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/webhook/dist ./dist
COPY --from=builder /app/crates/webhook-verifier/index.node /app/crates/webhook-verifier/index.node
COPY --from=builder /app/crates/webhook-verifier/package.json /app/crates/webhook-verifier/package.json
COPY --from=builder /app/crates/zk-verifier/index.node /app/crates/zk-verifier/index.node
COPY --from=builder /app/crates/zk-verifier/package.json /app/crates/zk-verifier/package.json
COPY --from=builder /app/crates/zk-verifier/index.d.ts /app/crates/zk-verifier/index.d.ts
# Runtime pieces of the stellar-utils addon (package.json → main: native/index.node).
# Placed at /app/crates/… so `require('../../../../crates/stellar-utils')` from
# dist/routes/auth resolves correctly.
COPY --from=builder /app/crates/stellar-utils/package.json /app/crates/stellar-utils/package.json
COPY --from=builder /app/crates/stellar-utils/native /app/crates/stellar-utils/native

# node user/group already exists in official node:24-alpine image
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
