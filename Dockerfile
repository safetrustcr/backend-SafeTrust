FROM debian:bookworm-slim

# Install required packages
RUN apt-get update -y && apt-get install -y curl socat ca-certificates

# Install Hasura CLI directly from GitHub releases
RUN curl -L "https://github.com/hasura/graphql-engine/releases/latest/download/cli-hasura-linux-amd64" -o /usr/local/bin/hasura \
    && chmod +x /usr/local/bin/hasura

WORKDIR /app

COPY . .

RUN chmod +x ./start.sh

CMD ["./start.sh"]