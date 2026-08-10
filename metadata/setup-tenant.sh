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
ADMIN_SECRET="myadminsecretkey"
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

# ── Process each tenant sequentially ─────────────────────────────────────────
for TENANT in "${TENANTS[@]}"; do
  echo "────────────────────────────────────────────────────"
  echo "  Processing tenant: $TENANT"
  echo "────────────────────────────────────────────────────"

  TENANT_START=$SECONDS

  # Step 1 — Build metadata (base + tenant-specific merge)
  echo "🔨 Building metadata for $TENANT..."
  if ! "$SCRIPT_DIR/build-metadata.sh" "$TENANT"; then
    echo "❌ [$TENANT] Build failed."
    FAILED_TENANTS+=("$TENANT")
    continue
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
    FAILED_TENANTS+=("$TENANT")
    continue
  fi

  TENANT_ELAPSED=$(( SECONDS - TENANT_START ))
  echo ""
  echo "✅ [$TENANT] Successfully deployed in ${TENANT_ELAPSED}s"
  SUCCESSFUL_TENANTS+=("$TENANT")
  echo ""
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