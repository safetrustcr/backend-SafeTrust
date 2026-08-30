FROM debian:bookworm-slim

# Install required packages
RUN apt-get update -y && apt-get install -y curl socat ca-certificates

# Install Hasura CLI directly from GitHub releases
RUN curl -L "https://github.com/hasura/graphql-engine/releases/latest/download/cli-hasura-linux-amd64" -o /usr/local/bin/hasura \
    && chmod +x /usr/local/bin/hasura

# Install pinned yq (replaces runtime download in migrate-test)
RUN ARCH=$(case "$(uname -m)" in aarch64|arm64) echo arm64;; *) echo amd64;; esac) \
    && curl -L "https://github.com/mikefarah/yq/releases/download/v4.44.1/yq_linux_${ARCH}" -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq

WORKDIR /app

COPY . .

RUN chmod +x ./start.sh

CMD ["./start.sh"]