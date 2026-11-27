# Hasura CLI image — migrations, seeds and metadata tooling.
#
# Base image is pinned by digest; the tag in the comment is what Dependabot tracks.
# THE IMAGE RUNS AS A NON-ROOT USER AND CONTAINS ONLY THE HASURA PROJECT, never
# the repository (no .env files, keys, CI config or docs).
FROM debian:bookworm-slim@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e # bookworm-slim

# --no-install-recommends keeps the package set minimal; the apt cache is
# removed so the layer does not ship package indexes.
# socat is gone: it was only needed for the Hasura v1.x loopback port
# workaround (see start.sh), and Hasura v2.47.0 binds where it is told.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        jq \
    && rm -rf /var/lib/apt/lists/*

# Hasura CLI directly from GitHub releases (checksum verification: CI security issue).
RUN curl -fsSL "https://github.com/hasura/graphql-engine/releases/latest/download/cli-hasura-linux-amd64" -o /usr/local/bin/hasura \
    && chmod 0755 /usr/local/bin/hasura

# Pinned yq (used by bin/prepare-test-db instead of downloading it at runtime).
RUN ARCH=$(case "$(uname -m)" in aarch64|arm64) echo arm64;; *) echo amd64;; esac) \
    && curl -fsSL "https://github.com/mikefarah/yq/releases/download/v4.44.1/yq_linux_${ARCH}" -o /usr/local/bin/yq \
    && chmod 0755 /usr/local/bin/yq

# Non-root runtime user; the CLI keeps its downloaded console assets in $HOME.
RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin hasura

WORKDIR /app

# Copy only what the Hasura CLI needs — never `COPY . .`.
COPY --chown=hasura:hasura config.yaml ./
COPY --chown=hasura:hasura migrations/ ./migrations/
COPY --chown=hasura:hasura metadata/ ./metadata/
COPY --chown=hasura:hasura seeds/ ./seeds/
COPY --chown=hasura:hasura bin/ ./bin/
COPY --chown=hasura:hasura start.sh ./
RUN chmod 0755 ./start.sh ./bin/*

USER hasura

CMD ["./start.sh"]
