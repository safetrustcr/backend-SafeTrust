#!/usr/bin/env bash
# Apply the enhance_pricing_overrides migration using psql.
# Run from repo root. Requires: DB user must be allowed to CREATE SCHEMA
# (e.g. superuser or database owner). If you see "permission denied for database
# postgres", connect as a user with create rights or use Hasura migrate apply.
#
# By default runs the full dependency chain, then enhance migration.
# To run only the enhance migration (schemas/tables must already exist):
#   ./bin/apply_enhance_pricing_overrides_psql.sh --only-enhance

set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Default connection (override with PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD)
# Use a user that can CREATE SCHEMA (e.g. postgres superuser or DB owner).
export PGPASSWORD="${PGPASSWORD:-postgrespassword}"
PSQL_OPTS=(-h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")

run_sql() {
  psql "${PSQL_OPTS[@]}" -f "$1"
}

RUN_DEPS=true
for arg in "$@"; do
  [[ "$arg" == "--only-enhance" ]] && RUN_DEPS=false
done

if [[ "$RUN_DEPS" == "true" ]]; then
  echo "[1/4] Creating shared schema and pricing_rules..."
  run_sql migrations/shared/0001_pricing_rules/up.sql
  echo "[2/4] Creating safetrust schema and pricing_rules..."
  run_sql migrations/safetrust/1756344655_create_pricing_rules/up.sql
  echo "[3/4] Creating safetrust.pricing_overrides..."
  run_sql migrations/safetrust/1756337360_create_pricing_overrides/up.sql
  echo "[4/4] Applying enhance_pricing_overrides (up.sql)..."
else
  echo "Applying enhance_pricing_overrides only (schemas must already exist)..."
fi

run_sql migrations/safetrust/20250925120000_enhance_pricing_overrides/up.sql
echo "Done."
