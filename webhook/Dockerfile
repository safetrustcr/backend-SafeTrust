# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Rust toolchain for both Neon addons (webhook-verifier + stellar-utils).
# gcc + musl-dev provide the C linker and musl headers rustc needs on Alpine.
RUN apk add --no-cache curl build-base rust cargo gcc musl-dev

WORKDIR /app

COPY webhook/package*.json ./webhook/
WORKDIR /app/webhook
RUN npm ci

WORKDIR /app
COPY webhook/tsconfig.json ./webhook/
COPY webhook/src/ ./webhook/src/
# Copy stellar-utils before the repo-root Cargo workspace so this crate
# stays a standalone package (it is not a workspace member).
COPY webhook/crates/ ./webhook/crates/

# Build stellar-utils → native/index.node (Node-API v6, ABI-stable).
RUN cd /app/webhook/crates/stellar-utils \
    && cargo build --release \
    && mkdir -p native \
    && cp target/release/libstellar_utils.so native/index.node

COPY crates/ ./crates/
COPY Cargo.toml Cargo.lock ./

WORKDIR /app/webhook
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
# Runtime pieces of the stellar-utils addon (package.json → main: native/index.node)
COPY --from=builder /app/webhook/crates/stellar-utils/package.json ./crates/stellar-utils/package.json
COPY --from=builder /app/webhook/crates/stellar-utils/native ./crates/stellar-utils/native

# node user/group already exists in official node:24-alpine image
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
