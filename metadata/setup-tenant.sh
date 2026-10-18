#!/usr/bin/env bash
set -eo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# setup-tenant.sh
# Runs build-metadata.sh then deploy-tenant.sh for one or more tenants.
#
# deploy-tenant.sh applies the complete metadata for a tenant: source config,
# table configuration, permissions, relationships, event triggers, functions,
# and shared metadata. Tenants are processed sequentially because each deploy
# replaces the full metadata document assembled from the server's current
# metadata; concurrent replaces could silently drop another tenant's source.
#
# Usage:
#   ./setup-tenant.sh <tenant1> [tenant2 ...] [--admin-secret SECRET] [--endpoint URL]
#
# Examples:
#   ./setup-tenant.sh safetrust
#   ./setup-tenant.sh safetrust hotel_industry
#   ./setup-tenant.sh safetrust hotel_industry --admin-secret myadminsecretkey --endpoint http://localhost:8080
#
# Cloud (explicit endpoint and explicit admin secret, preferably via env):
#   HASURA_GRAPHQL_ADMIN_SECRET=... ./setup-tenant.sh safetrust \
#     --cloud --endpoint https://example.hasura.app
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults — local development remains localhost.
ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-}"
ENDPOINT="${HASURA_GRAPHQL_ENDPOINT:-http://localhost:8080}"
TENANTS=()
DEPLOY_FLAGS=()

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
    --cloud)
      DEPLOY_FLAGS+=(--cloud)
      shift
      ;;
    --skip-role-checks)
      DEPLOY_FLAGS+=(--skip-role-checks)
      shift
      ;;
    -h | --help)
      cat <<'USAGE'
Usage: ./setup-tenant.sh <tenant1> [tenant2 ...] [options]

Builds and deploys complete Hasura metadata for each tenant.

Options:
  --admin-secret SECRET  Hasura admin secret (prefer HASURA_GRAPHQL_ADMIN_SECRET)
  --endpoint URL         Hasura endpoint (default: http://localhost:8080)
  --cloud                Require an explicit non-local https endpoint
  --skip-role-checks     Skip post-deploy guest/host role verification
  -h, --help             Show this help

Cloud example:
  HASURA_GRAPHQL_ADMIN_SECRET=... ./setup-tenant.sh safetrust \
    --cloud --endpoint https://example.hasura.app
USAGE
      exit 0
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

# ── Per-tenant build + complete metadata deploy ───────────────────────────────
SUCCESSFUL_TENANTS=()
FAILED_TENANTS=()
SETUP_START=$SECONDS

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

  # Step 2 — Deploy the complete metadata document for this tenant.
  # deploy-tenant.sh validates migrations, applies configuration/permissions/
  # relationships/event triggers, checks consistency, and verifies role access.
  echo "🚀 Deploying metadata for $TENANT..."
  if ! "$SCRIPT_DIR/deploy-tenant.sh" "$TENANT" \
      --endpoint "$ENDPOINT" \
      --admin-secret "$ADMIN_SECRET" \
      ${DEPLOY_FLAGS[@]+"${DEPLOY_FLAGS[@]}"}; then
    echo "❌ [$TENANT] Deploy failed."
    FAILED_TENANTS+=("$TENANT")
    continue
  fi

  TENANT_ELAPSED=$((SECONDS - TENANT_START))
  echo ""
  echo "✅ [$TENANT] Successfully deployed in ${TENANT_ELAPSED}s"
  SUCCESSFUL_TENANTS+=("$TENANT")
done

SETUP_ELAPSED=$((SECONDS - SETUP_START))

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
