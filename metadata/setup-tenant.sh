#!/usr/bin/env bash
set -eo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# setup-tenant.sh
# Runs build-metadata.sh then deploy-tenant.sh for one or more tenants.
# Function tracking is handled entirely by deploy-tenant.sh — no duplicate
# tracking logic here.
#
# Usage:
#   ./setup-tenant.sh <tenant1> [tenant2 ...] [--admin-secret SECRET] [--endpoint URL]
#
# Examples:
#   ./setup-tenant.sh safetrust
#   ./setup-tenant.sh safetrust hotel_industry
#   ./setup-tenant.sh safetrust hotel_industry --admin-secret myadminsecretkey --endpoint http://localhost:8080
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-}"
ENDPOINT="http://localhost:8080"
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

# ── Per-tenant tracking ───────────────────────────────────────────────────────
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

    # Step 2 — Deploy metadata
    # deploy-tenant.sh handles: source registration, table tracking, function tracking
    # Do NOT add any duplicate tracking logic here.
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