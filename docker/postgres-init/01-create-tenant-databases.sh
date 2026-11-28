#!/usr/bin/env bash
# Runs once, on first initialisation of the Postgres data volume.
# Creates one database per tenant so tenants share no schema, extensions or
# connection target. Keep this list in sync with metadata/tenants/*.
set -euo pipefail

for db in safetrust hotel_industry; do
  echo "[init] creating tenant database: $db"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE \"$db\""
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" \
    -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"' \
    -c 'CREATE EXTENSION IF NOT EXISTS postgis'
done
