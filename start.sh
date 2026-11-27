#!/usr/bin/env bash
# start.sh — Hasura CLI container entrypoint
# Used by hasura-cli-test in docker-compose-test.yml
set -euo pipefail

HASURA_FOLDER="${HASURA_FOLDER:-/app}"
cd "$HASURA_FOLDER" || {
    echo "❌ Hasura folder '$HASURA_FOLDER' not found"
    exit 1
}

# No socat: it was only needed for the Hasura v1.x loopback-port workaround
# (github.com/hasura/graphql-engine/issues/2824). On v2.47.0 with --address 0.0.0.0
# the console (9696) and CLI API (9693) bind directly, so it is not installed.

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
