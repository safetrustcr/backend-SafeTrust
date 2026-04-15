#!/usr/bin/env bash
set -eo pipefail

# ─────────────────────────────────────────────
# setup-tenant.sh
# Runs build-metadata.sh then deploy-tenant.sh
# for one or all tenants in a single command.
#
# Usage:
#   ./setup-tenant.sh <tenant_name> [--admin-secret SECRET] [--endpoint URL]
#   ./setup-tenant.sh safetrust
#   ./setup-tenant.sh safetrust --admin-secret myadminsecretkey --endpoint http://localhost:8080
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
ADMIN_SECRET="myadminsecretkey"
ENDPOINT="http://localhost:8080"
TENANT=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-secret)
      ADMIN_SECRET="$2"
      shift 2
      ;;
    --endpoint)
      ENDPOINT="$2"
      shift 2
      ;;
    -*)
      echo "Unknown option: $1"
      exit 1
      ;;
    *)
      TENANT="$1"
      shift
      ;;
  esac
done

if [[ -z "$TENANT" ]]; then
  echo "Usage: ./setup-tenant.sh <tenant_name> [--admin-secret SECRET] [--endpoint URL]"
  echo "Example: ./setup-tenant.sh safetrust --endpoint http://localhost:8080"
  exit 1
fi

echo ""
echo "════════════════════════════════════════"
echo "  SafeTrust Tenant Setup"
echo "  Tenant:   $TENANT"
echo "  Endpoint: $ENDPOINT"
echo "════════════════════════════════════════"
echo ""

# Step 1 — Build metadata
echo "▶ Step 1/2 — Building metadata for: $TENANT"
bash "$SCRIPT_DIR/build-metadata.sh" "$TENANT"
echo "✅ Build complete"
echo ""

# Step 2 — Deploy tenant
echo "▶ Step 2/2 — Deploying tenant: $TENANT"
bash "$SCRIPT_DIR/deploy-tenant.sh" "$TENANT" \
  --admin-secret "$ADMIN_SECRET" \
  --endpoint "$ENDPOINT"
echo "✅ Deploy complete"
echo ""

echo "════════════════════════════════════════"
echo "  ✅ $TENANT is ready"
echo "════════════════════════════════════════"