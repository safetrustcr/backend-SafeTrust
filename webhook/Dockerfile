# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Rust toolchain — required to compile the stellar-utils Neon addon
# (crates/stellar-utils) into native/index.node. gcc + musl-dev provide the
# C linker and musl headers that rustc needs on Alpine.
RUN apk add --no-cache rust cargo gcc musl-dev

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY crates/ ./crates/

# Build the Rust crates → native/index.node (Node-API v6, ABI-stable).
RUN cd crates/stellar-utils \
    && cargo build --release \
    && mkdir -p native \
    && cp target/release/libstellar_utils.so native/index.node

RUN cd crates/soroban-reconciler \
    && cargo build --release \
    && mkdir -p native \
    && cp target/release/libsoroban_reconciler.so native/index.node

RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:24-alpine AS production

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
# Runtime pieces of the native addons (package.json → main: native/index.node)
COPY --from=builder /app/crates/stellar-utils/package.json ./crates/stellar-utils/package.json
COPY --from=builder /app/crates/stellar-utils/native ./crates/stellar-utils/native
COPY --from=builder /app/crates/soroban-reconciler/package.json ./crates/soroban-reconciler/package.json
COPY --from=builder /app/crates/soroban-reconciler/native ./crates/soroban-reconciler/native

# node user/group already exists in official node:24-alpine image
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
