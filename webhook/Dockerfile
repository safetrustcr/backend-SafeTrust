# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Install Rust toolchain for Neon compilation
RUN apk add --no-cache curl build-base
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

COPY webhook/package*.json ./webhook/
WORKDIR /app/webhook
RUN npm ci

WORKDIR /app
COPY webhook/tsconfig.json ./webhook/
COPY webhook/src/ ./webhook/src/
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

# node user/group already exists in official node:24-alpine image
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
