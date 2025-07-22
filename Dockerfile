FROM debian:bullseye-slim

RUN apt-get update -y && apt-get install -y curl socat

# Install Hasura CLI
RUN curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash
RUN chmod +x /usr/local/bin/hasura

WORKDIR /app
COPY . .
RUN chmod +x ./start.sh
CMD ["./start.sh"]