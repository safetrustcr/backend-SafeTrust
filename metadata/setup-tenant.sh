#!/usr/bin/env bash
set -eo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# setup-tenant.sh
# Runs build-metadata.sh then deploy-tenant.sh for one or more tenants.
# deploy-tenant.sh applies the complete metadata document (source, table
# configuration, permissions, relationships, and event triggers), validates
# migrations first, and preserves other tenants' sources.
#
# Usage:
#   ./setup-tenant.sh <tenant1> [tenant2 ...] [--admin-secret SECRET] [--endpoint URL]
#
# Environment:
#   HASURA_ENDPOINT              Default endpoint (localhost unless overridden)
#   HASURA_GRAPHQL_ADMIN_SECRET  Default admin secret
#
# Examples:
#   ./setup-tenant.sh safetrust
#   ./setup-tenant.sh safetrust hotel_industry
#   ./setup-tenant.sh safetrust --endpoint http://localhost:8080
#
#   # Hasura Cloud / remote endpoint (explicit target, secret from env)
#   HASURA_GRAPHQL_ADMIN_SECRET=... ./setup-tenant.sh safetrust \
#     --endpoint https://<project>.hasura.app
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-}"
ENDPOINT="${HASURA_ENDPOINT:-http://localhost:8080}"
TENANTS=()

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-secret)
      if [[ -z "${2:-}" || "${2:0:1}" == "-" ]]; then
        echo "❌ Error: --admin-secret requires a value"
        exit 1
      fi
      ADMIN_SECRET="$2"
      shift 2
      ;;
    --endpoint)
      if [[ -z "${2:-}" || "${2:0:1}" == "-" ]]; then
        echo "❌ Error: --endpoint requires a value"
        exit 1
      fi
      ENDPOINT="$2"
      shift 2
      ;;
    -*)
      echo "❌ Unknown option: $1"
      exit 1
      ;;
    *)
      TENANTS+=("$1")
      shift
      ;;
  esac
done

# ── Validate at least one tenant was provided ─────────────────────────────────
if [[ ${#TENANTS[@]} -eq 0 ]]; then
  echo "❌ Error: At least one tenant name is required."
  echo ""
  echo "Usage:   ./setup-tenant.sh <tenant1> [tenant2 ...] [--admin-secret SECRET] [--endpoint URL]"
  echo "Example: ./setup-tenant.sh safetrust hotel_industry --endpoint http://localhost:8080"
  echo "Cloud:   HASURA_GRAPHQL_ADMIN_SECRET=... ./setup-tenant.sh safetrust --endpoint https://<project>.hasura.app"
  exit 1
fi

# ── Validate admin secret is set ──────────────────────────────────────────────
if [[ -z "$ADMIN_SECRET" ]]; then
  echo "❌ Error: Hasura admin secret not set. Provide via --admin-secret or HASURA_GRAPHQL_ADMIN_SECRET env var"
  exit 1
fi

# ── Summary header ────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  SafeTrust Multi-Tenant Setup"
echo "  Tenants:  ${TENANTS[*]}"
echo "  Endpoint: $ENDPOINT"
echo "════════════════════════════════════════════════════"
echo ""

# ── Per-tenant build + complete metadata deployment ─────────────────────────
SUCCESSFUL_TENANTS=()
FAILED_TENANTS=()
SETUP_START=$SECONDS

# ── Parallel tenant processing with per-tenant log capture ────────────────────
PIDS=()
LOG_FILES=()

for TENANT in "${TENANTS[@]}"; do
  LOG_FILE=$(mktemp)
  LOG_FILES+=("$LOG_FILE")

  (
    echo "────────────────────────────────────────────────────"
    echo "  Processing tenant: $TENANT"
    echo "────────────────────────────────────────────────────"

    TENANT_START=$SECONDS

    # Step 1 — Build metadata (base + tenant-specific merge)
    echo "🔨 Building metadata for $TENANT..."
    if ! "$SCRIPT_DIR/build-metadata.sh" "$TENANT"; then
      echo "❌ [$TENANT] Build failed."
      exit 1
    fi
    echo "✅ Metadata built for $TENANT"
    echo ""

    # Step 2 — Deploy complete metadata
    # deploy-tenant.sh validates migrations, applies source/table configuration,
    # permissions, relationships, and event triggers, then verifies consistency
    # and representative guest/host role queries. Do NOT add duplicate metadata
    # logic here.
    # Multi-tenant deploys are safe to run in parallel: deploy-tenant.sh
    # serializes whole-document replacements per endpoint.
    echo "🚀 Deploying metadata for $TENANT..."
    if ! "$SCRIPT_DIR/deploy-tenant.sh" "$TENANT" \
        --endpoint "$ENDPOINT" \
        --admin-secret "$ADMIN_SECRET"; then
      echo "❌ [$TENANT] Deploy failed."
      exit 1
    fi

    TENANT_ELAPSED=$(( SECONDS - TENANT_START ))
    echo ""
    echo "✅ [$TENANT] Successfully deployed in ${TENANT_ELAPSED}s"
  ) > "$LOG_FILE" 2>&1 &

  PIDS+=($!)
done

# ── Wait for all tenant processes and collect results ────────────────────────
for i in "${!PIDS[@]}"; do
  TENANT="${TENANTS[$i]}"
  PID="${PIDS[$i]}"
  LOG_FILE="${LOG_FILES[$i]}"

  # Stream per-tenant log to stdout as it completes
  if wait "$PID"; then
    SUCCESSFUL_TENANTS+=("$TENANT")
  else
    FAILED_TENANTS+=("$TENANT")
  fi

  # Print captured log for this tenant
  cat "$LOG_FILE"
  rm -f "$LOG_FILE"
done

SETUP_ELAPSED=$(( SECONDS - SETUP_START ))

# ── Summary ───────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════"
echo "  SETUP SUMMARY"
echo "  Total tenants:    ${#TENANTS[@]}"
echo "  ✅ Successful:    ${#SUCCESSFUL_TENANTS[@]}  — ${SUCCESSFUL_TENANTS[*]:-none}"
echo "  ⛔ Failed:        ${#FAILED_TENANTS[@]}  — ${FAILED_TENANTS[*]:-none}"
echo "  ⏱️  Total time:    ${SETUP_ELAPSED}s"
echo "════════════════════════════════════════════════════"

if [[ ${#FAILED_TENANTS[@]} -gt 0 ]]; then
  echo "⛔ Some tenants failed. Check the output above for details."
  exit 1
fi

echo "🎉 All tenants are ready!"