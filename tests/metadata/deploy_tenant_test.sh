#!/usr/bin/env bash
# End-to-end tests for metadata/deploy-tenant.sh.
#
# A stateful Python mock implements the Hasura metadata/GraphQL endpoints and a
# stub hasura CLI reports migration status. No Docker or real Hasura instance is
# required. Tests cover:
#   • fresh deploy applies permissions, relationships, event triggers, functions
#   • re-deploy reconciles changed permissions/configuration and is idempotent
#   • failed metadata API responses fail loudly
#   • one tenant's deploy preserves another tenant's source and shared metadata
#   • pending migrations block dependent metadata
#   • inconsistent metadata is detected
#   • guest/host role operations are verified
#   • Cloud target requires an explicit non-local https endpoint
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$ROOT_DIR/tests/metadata"
TMP_DIR="$(mktemp -d)"
MOCK_PID=""
DEPLOY_STATUS=0
DEPLOY_LOG="$TMP_DIR/deploy.log"

cleanup() {
  if [[ -n "$MOCK_PID" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

for tool in jq curl python3 yq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ Missing test dependency: $tool" >&2
    echo "   Install mikefarah yq v4 and jq before running these tests." >&2
    exit 1
  fi
done

# ── Stub hasura CLI (only migrate status is used by deploy-tenant.sh) ─────────
STUB_BIN="$TMP_DIR/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/hasura" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "migrate" && "${2:-}" == "status" ]]; then
  if [[ -n "${MOCK_MIGRATE_STATUS_FILE:-}" && -f "$MOCK_MIGRATE_STATUS_FILE" ]]; then
    cat "$MOCK_MIGRATE_STATUS_FILE"
  else
    echo "VERSION NAME SOURCE STATUS DATABASE STATUS"
    echo "1731908059919 create_uuid_extension Present Present"
  fi
  exit "${MOCK_MIGRATE_STATUS_EXIT:-0}"
fi
if [[ "${1:-}" == "metadata" && "${2:-}" == "reload" ]]; then
  exit 0
fi
echo "unexpected hasura invocation: $*" >&2
exit 1
STUB
chmod +x "$STUB_BIN/hasura"
export PATH="$STUB_BIN:$PATH"

STATUS_OK="$TMP_DIR/migration-status-ok.txt"
cat > "$STATUS_OK" <<'EOF'
VERSION        NAME                    SOURCE STATUS  DATABASE STATUS
1731908059919  create_uuid_extension   Present        Present
1731908676359  create_users            Present        Present
EOF

STATUS_PENDING="$TMP_DIR/migration-status-pending.txt"
cat > "$STATUS_PENDING" <<'EOF'
VERSION        NAME                    SOURCE STATUS  DATABASE STATUS
1731908059919  create_uuid_extension   Present        Present
1731908676359  create_users            Present        Not Present
EOF

# ── Build the baseline metadata once with the real build script ──────────────
BASELINE_BUILD="$TMP_DIR/build-baseline"
echo "⚙️  Building baseline metadata for tests..."
for tenant in safetrust hotel_industry; do
  BUILD_DIR="$BASELINE_BUILD" "$ROOT_DIR/metadata/build-metadata.sh" "$tenant" >/dev/null
done
if [[ ! -f "$BASELINE_BUILD/safetrust/databases/databases.yaml" \
   || ! -f "$BASELINE_BUILD/hotel_industry/databases/databases.yaml" ]]; then
  echo "❌ Baseline metadata build did not produce both tenant databases.yaml files" >&2
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
fail_test() {
  echo "❌ $*" >&2
  echo "--- deploy log ---" >&2
  cat "$DEPLOY_LOG" >&2 2>/dev/null || true
  exit 1
}

assert_status() {
  [[ "$DEPLOY_STATUS" -eq "$1" ]] || fail_test "expected exit status $1, got $DEPLOY_STATUS"
}

assert_log_contains() {
  grep -q -- "$1" "$DEPLOY_LOG" || fail_test "deploy log does not contain: $1"
}

assert_log_not_contains() {
  if grep -q -- "$1" "$DEPLOY_LOG"; then
    fail_test "deploy log unexpectedly contains: $1"
  fi
}

assert_jq() {
  local expression="$1"
  local file="$2"
  jq -e "$expression" "$file" >/dev/null 2>&1 \
    || fail_test "jq assertion failed: $expression (file: $file)"
}

assert_calls() {
  local expression="$1"
  jq -e -s "$expression" "$MOCK_CALLS" >/dev/null 2>&1 \
    || fail_test "mock call assertion failed: $expression"
}

assert_no_secret() {
  assert_log_not_contains "testsecret"
}

reset_build() {
  rm -rf "$TMP_DIR/build"
  cp -a "$BASELINE_BUILD" "$TMP_DIR/build"
  export BUILD_DIR="$TMP_DIR/build"
}

new_state() {
  local state_file="$1"
  if [[ $# -gt 1 ]]; then
    cp "$2" "$state_file"
  else
    printf '{"version":3,"sources":[]}\n' > "$state_file"
  fi
}

start_mock() {
  local state_file="$1"
  shift || true
  local ready_file="$TMP_DIR/mock-ready.json"
  local mock_log="$TMP_DIR/mock.log"
  MOCK_CALLS="$TMP_DIR/mock-calls.log"
  rm -f "$ready_file" "$MOCK_CALLS"
  : > "$mock_log"

  # Export extra KEY=VALUE flags so the stub hasura CLI (a child of the deploy
  # script) sees them as well as the mock server.
  unset MOCK_MIGRATE_STATUS_FILE MOCK_FAIL_REPLACE MOCK_INCONSISTENT MOCK_ROLE_FAIL
  local kv
  for kv in "$@"; do
    export "$kv"
  done

  env MOCK_ADMIN_SECRET=testsecret \
    python3 "$TEST_DIR/mock_hasura.py" \
      --state "$state_file" \
      --calls "$MOCK_CALLS" \
      --ready-file "$ready_file" \
      --port 0 >"$mock_log" 2>&1 &
  MOCK_PID=$!

  local i
  for i in $(seq 1 100); do
    [[ -s "$ready_file" ]] && break
    if ! kill -0 "$MOCK_PID" 2>/dev/null; then
      cat "$mock_log" >&2
      fail_test "mock Hasura exited during startup"
    fi
    sleep 0.05
  done
  if [[ ! -s "$ready_file" ]]; then
    cat "$mock_log" >&2
    fail_test "mock Hasura did not become ready"
  fi

  local port
  port=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["port"])' "$ready_file")
  ENDPOINT="http://127.0.0.1:${port}"
}

stop_mock() {
  if [[ -n "$MOCK_PID" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=""
  fi
}

run_deploy() {
  DEPLOY_LOG="$TMP_DIR/deploy.log"
  set +e
  "$ROOT_DIR/metadata/deploy-tenant.sh" "$1" \
    --endpoint "${ENDPOINT:-http://127.0.0.1:1}" \
    --admin-secret testsecret >"$DEPLOY_LOG" 2>&1
  DEPLOY_STATUS=$?
  set -e
}

run_setup() {
  DEPLOY_LOG="$TMP_DIR/deploy.log"
  set +e
  "$ROOT_DIR/metadata/setup-tenant.sh" "$@" \
    --endpoint "${ENDPOINT:-http://127.0.0.1:1}" \
    --admin-secret testsecret >"$DEPLOY_LOG" 2>&1
  DEPLOY_STATUS=$?
  set -e
}

record_pass() {
  echo "✅ $1"
}

# ── Test 1: fresh deployment applies the complete metadata ───────────────────
test_fresh_deploy() {
  reset_build
  local state="$TMP_DIR/state-fresh.json"
  new_state "$state"
  start_mock "$state"

  run_deploy safetrust
  assert_status 0
  assert_no_secret

  assert_jq '(.sources | length) == 1' "$state"
  assert_jq '.sources[0].name == "safetrust"' "$state"
  assert_jq '
    .sources[0].tables[]
    | select(.table.name == "apartments")
    | .select_permissions
    | any(.role == "guest")
  ' "$state"
  assert_jq '
    .sources[0].tables[]
    | select(.table.name == "bid_requests")
    | .object_relationships
    | any(.name == "apartment")
  ' "$state"
  assert_jq '
    .sources[0].tables[]
    | select(.table.name == "escrow_pending_approvals")
    | .event_triggers
    | any(.name == "on_escrow_approval_required")
  ' "$state"
  assert_jq '
    .sources[0].functions
    | any(.function.name == "find_apartments_by_owner")
  ' "$state"

  # Shared metadata from base + tenant is present.
  assert_jq '.actions | any(.name == "sendVerificationCode")' "$state"
  assert_jq '.actions | any(.name == "verify_wallet_signature")' "$state"
  assert_jq '.cron_triggers | any(.name == "reconciliation_sync_escrows")' "$state"

  # actions.graphql SDL is expanded into custom_types with fields; without this
  # replace_metadata would reject actions that reference undefined types.
  assert_jq '
    .custom_types.input_objects[]
    | select(.name == "SendVerificationInput")
    | (.fields | length) == 1
  ' "$state"
  assert_jq '
    .custom_types.objects[]
    | select(.name == "VerificationResponse")
    | (.fields | length) == 3
  ' "$state"
  assert_jq '
    .custom_types.input_objects[]
    | select(.name == "VerifyWalletInput")
    | (.fields | length) > 0
  ' "$state"
  assert_jq '([.actions[] | select(.name == "open_dispute")] | length) == 1' "$state"

  assert_calls 'any(.[]; .type == "replace_metadata")'
  assert_calls 'any(.[]; .type == "get_inconsistent_metadata")'
  assert_calls 'any(.[]; .kind == "graphql" and .role == "guest" and (.query | contains("RoleOperationProbe")))'
  assert_calls 'any(.[]; .kind == "graphql" and .role == "host" and (.query | contains("RoleOperationProbe")))'

  stop_mock
  record_pass "fresh deploy applies configuration, permissions, relationships, event triggers, functions, and shared metadata"
}

# ── Test 2: re-deploy reconciles changed permissions and is idempotent ───────
test_redeploy_reconciles() {
  reset_build
  local state="$TMP_DIR/state-redeploy.json"
  new_state "$state"
  start_mock "$state"

  run_deploy safetrust
  assert_status 0
  assert_no_secret
  jq -S . "$state" > "$TMP_DIR/applied-once.json"

  # Re-run with unchanged YAML: idempotent.
  run_deploy safetrust
  assert_status 0
  jq -S . "$state" > "$TMP_DIR/applied-twice.json"
  diff -u "$TMP_DIR/applied-once.json" "$TMP_DIR/applied-twice.json" \
    || fail_test "re-deploy changed metadata despite unchanged configuration"

  # Change a select permission and an object relationship, then re-deploy; the
  # already-tracked tables must be reconciled rather than skipped.
  yq -i '
    (.select_permissions[] | select(.role == "guest") | .permission.columns) = ["id"]
  ' "$BUILD_DIR/safetrust/databases/tables/public_apartments.yaml"
  yq -i '
    (.object_relationships[] | select(.name == "apartment") | .name) = "apartment_rel"
  ' "$BUILD_DIR/safetrust/databases/tables/public_bid_requests.yaml"

  run_deploy safetrust
  assert_status 0
  assert_no_secret
  assert_jq '
    .sources[0].tables[]
    | select(.table.name == "apartments")
    | .select_permissions[]
    | select(.role == "guest")
    | .permission.columns == ["id"]
  ' "$state"
  assert_jq '
    .sources[0].tables[]
    | select(.table.name == "bid_requests")
    | .object_relationships
    | any(.name == "apartment_rel")
  ' "$state"
  assert_jq '
    [(.sources[0].tables[] | select(.table.name == "bid_requests") | .object_relationships[]
      | select(.name == "apartment"))] | length == 0
  ' "$state"
  assert_jq '(.sources | length) == 1' "$state"

  stop_mock
  record_pass "re-deploy applies changed permissions and relationships and remains idempotent on unchanged config"
}

# ── Test 3: failed metadata API response is an explicit failure ───────────────
test_failed_metadata_api() {
  reset_build
  local state="$TMP_DIR/state-failure.json"
  new_state "$state"
  start_mock "$state" MOCK_FAIL_REPLACE=1

  run_deploy safetrust
  [[ "$DEPLOY_STATUS" -ne 0 ]] || fail_test "deploy succeeded despite replace_metadata failure"
  assert_no_secret
  assert_log_contains "replace_metadata failed"
  assert_log_not_contains "All tenants deployed successfully"
  assert_jq '(.sources | length) == 1' "$state"
  assert_jq '(.sources[0].tables // []) | length == 0' "$state"

  stop_mock
  record_pass "failed metadata API response returns non-zero with explicit diagnostics"
}

# ── Test 4: deploying one tenant preserves another tenant and shared metadata ─
test_multi_tenant_preservation() {
  reset_build
  local state="$TMP_DIR/state-multi.json"
  cat > "$state" <<'EOF'
{
  "version": 3,
  "sources": [
    {
      "name": "safetrust",
      "kind": "postgres",
      "configuration": {
        "connection_info": {
          "database_url": { "from_env": "PG_DATABASE_URL" }
        }
      },
      "tables": []
    },
    {
      "name": "hotel_industry",
      "kind": "postgres",
      "configuration": {
        "connection_info": {
          "database_url": { "from_env": "PG_DATABASE_URL" }
        }
      },
      "tables": [
        {
          "table": { "name": "hotels", "schema": "hotel_industry" },
          "select_permissions": [
            { "role": "admin", "permission": { "columns": "*", "filter": {} } }
          ]
        }
      ]
    }
  ],
  "actions": [
    {
      "name": "legacy_action",
      "definition": { "kind": "synchronous", "handler": "http://legacy/action" }
    }
  ],
  "inherited_roles": [
    { "role": "legacy_role", "role_set": ["anonymous"] }
  ],
  "cron_triggers": [
    { "name": "legacy_cron", "webhook": "http://legacy/cron", "schedule": "* * * * *" }
  ]
}
EOF

  jq -S '.sources[] | select(.name == "hotel_industry")' "$state" > "$TMP_DIR/hotel-before.json"
  start_mock "$state"

  run_deploy safetrust
  assert_status 0
  assert_no_secret

  assert_jq '
    (.sources | map(.name) | sort) == ["hotel_industry", "safetrust"]
  ' "$state"
  jq -S '.sources[] | select(.name == "hotel_industry")' "$state" > "$TMP_DIR/hotel-after.json"
  diff -u "$TMP_DIR/hotel-before.json" "$TMP_DIR/hotel-after.json" \
    || fail_test "deploying safetrust modified the hotel_industry source"

  assert_jq '.actions | any(.name == "legacy_action")' "$state"
  assert_jq '.inherited_roles | any(.role == "legacy_role")' "$state"
  assert_jq '.cron_triggers | any(.name == "legacy_cron")' "$state"
  assert_jq '
    .sources[] | select(.name == "safetrust") | .tables[]
    | select(.table.name == "apartments")
    | .select_permissions | any(.role == "guest")
  ' "$state"

  stop_mock
  record_pass "deploying one tenant preserves other sources and shared metadata"
}

# ── Test 5: pending migrations block dependent metadata ──────────────────────
test_migration_validation() {
  reset_build
  local state="$TMP_DIR/state-migrations.json"
  new_state "$state"
  start_mock "$state" MOCK_MIGRATE_STATUS_FILE="$STATUS_PENDING"

  run_deploy safetrust
  [[ "$DEPLOY_STATUS" -ne 0 ]] || fail_test "deploy succeeded with pending migrations"
  assert_no_secret
  assert_log_contains "Migrations are not fully applied"
  if jq -e -s 'any(.[]; .type == "replace_metadata")' "$MOCK_CALLS" >/dev/null 2>&1; then
    fail_test "replace_metadata was called before migrations were validated"
  fi
  assert_jq '(.sources[0].tables // []) | length == 0' "$state"

  stop_mock
  record_pass "pending migrations block permissions/relationships deployment"
}

# ── Test 6: inconsistent metadata is detected and fails the deploy ────────────
test_inconsistent_metadata() {
  reset_build
  local state="$TMP_DIR/state-inconsistent.json"
  new_state "$state"
  start_mock "$state" MOCK_INCONSISTENT=1

  run_deploy safetrust
  [[ "$DEPLOY_STATUS" -ne 0 ]] || fail_test "deploy succeeded despite inconsistent metadata"
  assert_no_secret
  assert_log_contains "Metadata is inconsistent after deployment"
  assert_calls 'any(.[]; .type == "replace_metadata")'

  stop_mock
  record_pass "inconsistent metadata is detected and reported"
}

# ── Test 7: guest/host role verification failure is explicit ─────────────────
test_role_verification_failure() {
  reset_build
  local state="$TMP_DIR/state-role-failure.json"
  new_state "$state"
  start_mock "$state" MOCK_ROLE_FAIL=host

  run_deploy safetrust
  [[ "$DEPLOY_STATUS" -ne 0 ]] || fail_test "deploy succeeded despite a failing host role check"
  assert_no_secret
  assert_log_contains "Role 'host'"
  assert_calls 'any(.[]; .kind == "graphql" and .role == "host")'

  stop_mock
  record_pass "failed guest/host role verification fails the deployment"
}

# ── Test 8: setup-tenant.sh deploys multiple tenants without erasing each other
test_setup_tenant_sequential() {
  reset_build
  local state="$TMP_DIR/state-setup.json"
  new_state "$state"
  start_mock "$state"

  run_setup safetrust hotel_industry
  assert_status 0
  assert_no_secret

  assert_jq '(.sources | map(.name) | sort) == ["hotel_industry", "safetrust"]' "$state"
  assert_jq '
    .sources[] | select(.name == "safetrust") | .tables[]
    | select(.table.name == "apartments")
    | .select_permissions | any(.role == "guest")
  ' "$state"
  assert_jq '
    .sources[] | select(.name == "hotel_industry") | .tables[]
    | select(.table.name == "reservations")
    | .configuration.custom_name == "hotel_reservations"
  ' "$state"

  # Safetrust-only actions and custom types survive the hotel_industry deploy.
  assert_jq '.actions | any(.name == "verify_wallet_signature")' "$state"
  assert_jq '
    .custom_types.input_objects[]
    | select(.name == "VerifyWalletInput")
    | (.fields | length) > 0
  ' "$state"
  assert_calls '[.[] | select(.type == "replace_metadata")] | length == 2'

  stop_mock
  record_pass "setup-tenant.sh deploys multiple tenants sequentially and preserves both sources"
}

# ── Test 9: orchestrators no longer suppress metadata setup/reload output ────
test_orchestrator_output_is_not_suppressed() {
  local file
  for file in "$ROOT_DIR/bin/start" "$ROOT_DIR/bin/deploy_init"; do
    if awk '/setup-tenant\.sh/ { for (i = 0; i < 3; i++) { print; getline } }' "$file" \
        | grep -q '/dev/null'; then
      fail_test "$file suppresses setup-tenant.sh output"
    fi
    if awk '/metadata reload/ { for (i = 0; i < 4; i++) { print; getline } }' "$file" \
        | grep -q '/dev/null'; then
      fail_test "$file suppresses metadata reload output"
    fi
  done

  record_pass "bin/start and bin/deploy_init do not suppress metadata setup/reload output"
}

# ── Test 10: Cloud target requires an explicit non-local endpoint ────────────
test_cloud_target_guard() {
  local log="$TMP_DIR/cloud-guard.log"
  set +e
  "$ROOT_DIR/metadata/deploy-tenant.sh" safetrust \
    --cloud \
    --endpoint http://localhost:8080 \
    --admin-secret testsecret >"$log" 2>&1
  local status=$?
  set -e

  [[ "$status" -ne 0 ]] || fail_test "--cloud accepted a local http endpoint"
  grep -q -- "--cloud requires an explicit https Hasura Cloud endpoint" "$log" \
    || fail_test "--cloud local endpoint guard did not explain the failure"

  record_pass "Cloud target requires an explicit non-local https endpoint"
}

# ── Run ───────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  metadata/deploy-tenant.sh tests"
echo "════════════════════════════════════════════════════"
echo ""

test_fresh_deploy
test_redeploy_reconciles
test_failed_metadata_api
test_multi_tenant_preservation
test_migration_validation
test_inconsistent_metadata
test_role_verification_failure
test_setup_tenant_sequential
test_orchestrator_output_is_not_suppressed
test_cloud_target_guard

echo ""
echo "🎉 All metadata deployment tests passed"
