# Use Alpine Linux as the base image
FROM alpine:3.18

# Install necessary dependencies
RUN apk add --no-cache \
    curl \
    bash \
    ca-certificates \
    && update-ca-certificates

# Download and install Hasura CLI
RUN curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash

# Set the working directory inside the container
WORKDIR /app

# Set the default command to show Hasura CLI help
CMD ["hasura", "help"]
