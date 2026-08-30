#!/usr/bin/env bash
# start.sh — Hasura CLI container entrypoint
# Used by hasura-cli-test in docker-compose-test.yml
set -euo pipefail

HASURA_FOLDER="${HASURA_FOLDER:-/app}"
cd "$HASURA_FOLDER" || {
    echo "❌ Hasura folder '$HASURA_FOLDER' not found"
    exit 1
}

# Note on socat workaround:
# The original issue (github.com/hasura/graphql-engine/issues/2824) was filed for Hasura v1.x
# where internal ports only bound to 127.0.0.1. On Hasura v2.x / v2.47.0 with --address 0.0.0.0,
# both the console (port 9696) and CLI API server (port 9693) bind to all interfaces directly,
# and the CLI communicates directly with GraphQL Engine via docker networking. Tested and verified
# on Hasura v2.47.0 / v2.x that the console functions normally without socat port-forwarding proxies.

# Start Hasura console with exec for proper signal handling (replaces PID 1)
echo "[start.sh] Starting Hasura console..."
exec hasura console \
    --log-level "${HASURA_LOG_LEVEL:-DEBUG}" \
    --address "0.0.0.0" \
    --no-browser \
    --endpoint "${HASURA_GRAPHQL_ENDPOINT:-http://graphql-engine:8080}" \
    --admin-secret "${HASURA_GRAPHQL_ADMIN_SECRET:-myadminsecretkey}" \
    --console-port "${CONSOLE_PORT:-9696}" \
    --api-port "${API_PORT:-9693}"
