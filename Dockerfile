FROM debian:bookworm-slim

# Install required packages
RUN apt-get update -y && apt-get install -y curl socat ca-certificates jq

# Install Hasura CLI directly from GitHub releases.
# Pinned to match the graphql-engine server version (v2.47.0 in
# docker-compose-test.yml). An unpinned `latest` silently drifts and can break
# `migrate apply` on a CLI/server version skew, producing non-reproducible CI.
ARG HASURA_CLI_VERSION=v2.47.0
ARG HASURA_CLI_SHA256=e1beb64a22ee90af6d1375bfd4d20a1f867706ab2c2090c7ecbda284bff77db6
RUN curl -fL "https://github.com/hasura/graphql-engine/releases/download/${HASURA_CLI_VERSION}/cli-hasura-linux-amd64" -o /usr/local/bin/hasura \
    && echo "${HASURA_CLI_SHA256}  /usr/local/bin/hasura" | sha256sum -c - \
    && chmod +x /usr/local/bin/hasura

# Install pinned yq (replaces runtime download in migrate-test)
RUN ARCH=$(case "$(uname -m)" in aarch64|arm64) echo arm64;; *) echo amd64;; esac) \
    && YQ_SHA256=$(case "${ARCH}" in arm64) echo 8c12fcc10e14774ca6624cc282f092a526568b036fe1192258c3aecbad56d063;; *) echo 6dc2d0cd4e0caca5aeffd0d784a48263591080e4a0895abe69f3a76eb50d1ba3;; esac) \
    && curl -fL "https://github.com/mikefarah/yq/releases/download/v4.44.1/yq_linux_${ARCH}" -o /usr/local/bin/yq \
    && echo "${YQ_SHA256}  /usr/local/bin/yq" | sha256sum -c - \
    && chmod +x /usr/local/bin/yq

WORKDIR /app

COPY . .

RUN chmod +x ./start.sh

CMD ["./start.sh"]