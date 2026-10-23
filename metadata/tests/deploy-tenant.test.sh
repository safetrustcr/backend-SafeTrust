#!/usr/bin/env bash
# Tests for metadata/deploy-tenant.sh.
#
# Runs without Docker, Hasura, or yq by placing stubs earlier in PATH:
#   - hasura migrate status
#   - yq (reads JSON fixtures instead of parsing real YAML)
#   - curl (emulates /v1/metadata and /v1/graphql)
#
# The fixtures deliberately start with a tracked table that has no permissions
# or relationships, matching the deployment gap this script fixes.
set -euo pipefail

TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$TEST_DIR/../deploy-tenant.sh"

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

STUB_DIR="$TMP_ROOT/bin"
STATE="$TMP_ROOT/state"
BUILD="$TMP_ROOT/build"
FIXTURES="$TMP_ROOT/fixtures"
mkdir -p "$STUB_DIR" "$STATE" "$BUILD" "$FIXTURES"

PASS=0
FAIL=0

pass() {
    PASS=$((PASS + 1))
    printf '  ok - %s\n' "$1"
}

fail_test() {
    FAIL=$((FAIL + 1))
    printf '  not ok - %s\n' "$1"
}

assert_eq() {
    local expected="$1" actual="$2" message="$3"
    if [[ "$expected" == "$actual" ]]; then
        pass "$message"
    else
        fail_test "$message (expected '$expected', got '$actual')"
    fi
}

assert_contains() {
    local file="$1" needle="$2" message="$3"
    if grep -Fq -- "$needle" "$file"; then
        pass "$message"
    else
        fail_test "$message"
        sed 's/^/      /' "$file" | tail -30
    fi
}

assert_not_contains() {
    local file="$1" needle="$2" message="$3"
    if grep -Fq -- "$needle" "$file"; then
        fail_test "$message"
    else
        pass "$message"
    fi
}

assert_jq() {
    local message="$1" filter="$2" file="$3"
    if jq -e "$filter" "$file" >/dev/null 2>&1; then
        pass "$message"
    else
        fail_test "$message"
        jq . "$file" >&2 || cat "$file" >&2
    fi
}

# ── Stubs ─────────────────────────────────────────────────────────────────────
cat > "$STUB_DIR/hasura" <<'HASURA_STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "migrate" && "${2:-}" == "status" ]]; then
    cat "$STUB_STATE/migrate-status.txt"
    exit "$(cat "$STUB_STATE/migrate-status-code")"
fi
echo "unexpected hasura invocation: $*" >&2
exit 1
HASURA_STUB

cat > "$STUB_DIR/yq" <<'YQ_STUB'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
    case "$arg" in
        *.yaml|*.yml)
            base=$(basename "$arg")
            case "$base" in
                databases.yaml)
                    cat "$FIXTURES/source-$DEPLOY_TENANT.json"
                    ;;
                tables.yaml|functions.yaml)
                    ;;
                *)
                    if [[ "$arg" == */tables/* ]]; then
                        fixture="$FIXTURES/table-${base%.*}.json"
                        [[ -f "$fixture" ]] && cat "$fixture" || echo '{}'
                    elif [[ "$arg" == */functions/* ]]; then
                        fixture="$FIXTURES/function-${base%.*}.json"
                        [[ -f "$fixture" ]] && cat "$fixture" || echo '{}'
                    else
                        echo '{}'
                    fi
                    ;;
            esac
            ;;
    esac
done
YQ_STUB

cat > "$STUB_DIR/curl" <<'CURL_STUB'
#!/usr/bin/env bash
set -euo pipefail

out=""
data=""
url=""
role=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        -w) shift 2 ;;
        -X) shift 2 ;;
        -d) data="$2"; shift 2 ;;
        -H)
            header="$2"
            shift 2
            case "$header" in
                X-Hasura-Role:*) role="${header#X-Hasura-Role: }" ;;
            esac
            ;;
        -s|-S|-sS|-f|-fsS) shift ;;
        http://*|https://*) url="$1"; shift ;;
        *) shift ;;
    esac
done

state="$STUB_STATE"
body=""
code=200

emit() {
    if [[ -n "$out" ]]; then
        printf '%s' "$1" > "$out"
    else
        printf '%s' "$1"
    fi
}

if [[ "$url" == */v1/metadata ]]; then
    type=$(jq -r '.type' <<<"$data")
    case "$type" in
        export_metadata)
            body=$(cat "$state/export.json")
            ;;
        replace_metadata)
            jq -c '{type:"replace_metadata", args:.args}' <<<"$data" >> "$state/replace-payloads.jsonl"
            if [[ -f "$state/fail-replace" ]]; then
                code=400
                body=$(cat "$state/fail-replace")
            elif [[ -f "$state/conflict-replace" ]]; then
                code=409
                body='{"error":"metadata resource version referenced (1) did not match current version","code":"conflict","path":"$"}'
            else
                jq -c '.args.metadata' <<<"$data" > "$state/applied.json"
                printf '%s\n' "$data" >> "$state/replace-calls.jsonl"
                body='{"message":"success"}'
            fi
            ;;
        get_inconsistent_metadata)
            if [[ -f "$state/inconsistent.json" ]]; then
                body=$(cat "$state/inconsistent.json")
            else
                body='{"is_consistent":true,"inconsistent_objects":[]}'
            fi
            ;;
        *)
            code=400
            body=$(jq -cn --arg type "$type" '{error:("unexpected metadata operation: " + $type)}')
            ;;
    esac
elif [[ "$url" == */v1/graphql ]]; then
    printf '%s\n' "$role" >> "$state/graphql-roles.log"
    query=$(jq -r '.query' <<<"$data")
    printf '%s\n' "$query" >> "$state/graphql-queries.log"

    if [[ -f "$state/fail-graphql-role-$role" ]]; then
        body=$(cat "$state/fail-graphql-role-$role")
    elif [[ "$query" == *"__schema"* ]]; then
        # Decoy fields mirror what a real schema exposes: a scalar field and an
        # action field without `limit`. Only the list-of-objects field with a
        # `limit` argument is queryable with `limit: 0`.
        body=$(jq -cn --arg role "$role" '
            {data:{__schema:{queryType:{fields:[
                {name:"search_hotels", type:{kind:"SCALAR"}, args:[{name:"limit", type:{kind:"INT"}, defaultValue:null}]},
                {name:"run_action", type:{kind:"SCALAR"}, args:[]},
                {name:("role_" + $role + "_items"), type:{kind:"LIST", ofType:{kind:"OBJECT"}}, args:[{name:"limit", type:{kind:"INT"}, defaultValue:null}]}
            ]}}}}')
    else
        body='{"data":{"__typename":"query_root"}}'
    fi
else
    code=404
    body='{"error":"unexpected url"}'
fi

emit "$body"
printf '%s' "$code"
CURL_STUB

chmod +x "$STUB_DIR/hasura" "$STUB_DIR/yq" "$STUB_DIR/curl"

# ── Fixtures ──────────────────────────────────────────────────────────────────
cat > "$FIXTURES/source-safetrust.json" <<'JSON'
[
  {
    "name": "safetrust",
    "kind": "postgres",
    "configuration": {
      "connection_info": {
        "database_url": {"from_env": "PG_DATABASE_URL"},
        "isolation_level": "read-committed",
        "use_prepared_statements": false
      }
    },
    "tables": "!include safetrust/tables/tables.yaml",
    "functions": "!include safetrust/functions/functions.yaml"
  }
]
JSON

cat > "$FIXTURES/source-hotel_industry.json" <<'JSON'
[
  {
    "name": "hotel_industry",
    "kind": "postgres",
    "configuration": {
      "connection_info": {
        "database_url": {"from_env": "PG_DATABASE_URL"},
        "isolation_level": "read-committed",
        "use_prepared_statements": false
      }
    },
    "tables": "!include hotel_industry/tables/tables.yaml",
    "functions": "!include hotel_industry/functions/functions.yaml"
  }
]
JSON

cat > "$FIXTURES/table-public_apartments.default.json" <<'JSON'
{
  "table": {"name": "apartments", "schema": "safetrust"},
  "configuration": {
    "custom_name": "safetrust_apartments",
    "column_config": {"price": {"custom_name": "price"}}
  },
  "select_permissions": [
    {
      "role": "guest",
      "permission": {
        "columns": ["id", "name", "price"],
        "filter": {"is_available": {"_eq": true}}
      }
    },
    {
      "role": "host",
      "permission": {
        "columns": ["id", "name", "price"],
        "filter": {"host_id": {"_eq": "x-hasura-user-id"}}
      }
    }
  ],
  "insert_permissions": [
    {"role": "host", "permission": {"columns": ["name", "price"], "check": {}}}
  ],
  "object_relationships": [
    {"name": "host", "using": {"foreign_key_constraint_on": "host_id"}}
  ],
  "array_relationships": [
    {
      "name": "images",
      "using": {
        "foreign_key_constraint_on": {
          "table": {"name": "apartment_images", "schema": "safetrust"},
          "column": "apartment_id"
        }
      }
    }
  ],
  "event_triggers": [
    {
      "name": "on_apartment_created",
      "definition": {"enable_manual": false, "insert": {"columns": "*"}},
      "retry_conf": {"num_retries": 3, "interval_sec": 10, "timeout_sec": 60},
      "webhook": "{{WEBHOOK_BASE_URL}}/events/apartment-created"
    }
  ]
}
JSON

cat > "$FIXTURES/table-public_apartments.changed.json" <<'JSON'
{
  "table": {"name": "apartments", "schema": "safetrust"},
  "configuration": {
    "custom_name": "safetrust_apartments_v2",
    "column_config": {"price": {"custom_name": "monthlyPrice"}}
  },
  "select_permissions": [
    {
      "role": "guest",
      "permission": {
        "columns": ["id", "name", "price"],
        "filter": {"is_available": {"_eq": false}}
      }
    },
    {
      "role": "host",
      "permission": {
        "columns": ["id", "name", "price"],
        "filter": {"host_id": {"_eq": "x-hasura-user-id"}}
      }
    }
  ],
  "object_relationships": [
    {"name": "owner", "using": {"foreign_key_constraint_on": "host_id"}}
  ]
}
JSON

cat > "$FIXTURES/table-hotel_industry_hotels.json" <<'JSON'
{
  "table": {"name": "hotels", "schema": "hotel_industry"},
  "configuration": {"custom_name": "hotel_industry_hotels"},
  "select_permissions": [
    {"role": "guest", "permission": {"columns": ["id", "name"], "filter": {}}},
    {"role": "host", "permission": {"columns": ["id", "name"], "filter": {}}}
  ],
  "object_relationships": [
    {"name": "rooms", "using": {"foreign_key_constraint_on": {"table": {"name": "rooms", "schema": "hotel_industry"}, "column": "hotel_id"}}}
  ]
}
JSON

cat > "$FIXTURES/export-default.json" <<'JSON'
{
  "resource_version": 1,
  "metadata": {
    "version": 3,
    "sources": [
      {
        "name": "safetrust",
        "kind": "postgres",
        "configuration": {
          "connection_info": {
            "database_url": {"from_env": "PG_DATABASE_URL"}
          }
        },
        "tables": [
          {
            "table": {"name": "apartments", "schema": "safetrust"},
            "configuration": {"custom_name": "legacy_apartments"}
          }
        ],
        "functions": []
      },
      {
        "name": "hotel_industry",
        "kind": "postgres",
        "configuration": {
          "connection_info": {
            "database_url": {"from_env": "PG_DATABASE_URL"}
          }
        },
        "tables": [
          {"table": {"name": "hotels", "schema": "hotel_industry"}}
        ],
        "functions": []
      }
    ],
    "actions": [{"name": "keep_action"}],
    "cron_triggers": [{"name": "keep_cron"}],
    "allow_list": []
  }
}
JSON

# ── Helpers ───────────────────────────────────────────────────────────────────
reset_build() {
    rm -rf "$BUILD"
    mkdir -p "$BUILD/safetrust/databases/tables"
    printf '%s\n' '- name: safetrust' '- kind: postgres' > "$BUILD/safetrust/databases/databases.yaml"
    touch "$BUILD/safetrust/databases/tables/tables.yaml"
    touch "$BUILD/safetrust/databases/tables/public_apartments.yaml"
    cp "$FIXTURES/table-public_apartments.default.json" \
        "$FIXTURES/table-public_apartments.json"
}

add_hotel_build() {
    mkdir -p "$BUILD/hotel_industry/databases/tables"
    printf '%s\n' '- name: hotel_industry' '- kind: postgres' \
        > "$BUILD/hotel_industry/databases/databases.yaml"
    touch "$BUILD/hotel_industry/databases/tables/tables.yaml"
    touch "$BUILD/hotel_industry/databases/tables/hotel_industry_hotels.yaml"
}

reset_state() {
    rm -rf "$STATE"
    mkdir -p "$STATE"
    cp "$FIXTURES/export-default.json" "$STATE/export.json"
    printf 'Migrations: Up to date\n' > "$STATE/migrate-status.txt"
    printf '0\n' > "$STATE/migrate-status-code"
    : > "$STATE/graphql-queries.log"
    : > "$STATE/graphql-roles.log"
    : > "$STATE/replace-calls.jsonl"
    rm -f "$STATE"/applied.json "$STATE"/fail-replace "$STATE"/inconsistent.json \
        "$STATE"/conflict-replace "$STATE"/replace-payloads.jsonl \
        "$STATE"/fail-graphql-role-*
    reset_build
}

run_deploy() {
    local tenant="$1"
    local output_file="$2"

    set +e
    PATH="$STUB_DIR:$PATH" \
        DEPLOY_TENANT="$tenant" \
        FIXTURES="$FIXTURES" \
        STUB_STATE="$STATE" \
        BUILD_DIR="$BUILD" \
        HASURA_ENDPOINT="http://stub.hasura:8080" \
        HASURA_GRAPHQL_ADMIN_SECRET="test-admin-secret" \
        bash "$DEPLOY_SCRIPT" "$tenant" \
            --endpoint "http://stub.hasura:8080" \
            --admin-secret "test-admin-secret" \
            >"$output_file" 2>&1
    STATUS=$?
    set -e
}

# ── Tests ─────────────────────────────────────────────────────────────────────
echo "deploy-tenant.sh tests"

# 1. Fresh deployment applies permissions, relationships, configuration, and
#    event triggers to a table that was already tracked.
reset_state
run_deploy safetrust "$TMP_ROOT/out-1.log"

assert_eq 0 "$STATUS" "fresh deploy succeeds"
assert_contains "$TMP_ROOT/out-1.log" "Metadata applied and consistent" "fresh deploy reports consistency"
assert_jq "source configuration is applied" \
    '[.sources[] | select(.name=="safetrust")][0].configuration.connection_info.database_url.from_env == "PG_DATABASE_URL"' \
    "$STATE/applied.json"
assert_jq "table configuration from YAML replaces the tracked configuration" \
    '[.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].configuration.custom_name == "safetrust_apartments"' \
    "$STATE/applied.json"
assert_jq "omitted guest/host select permissions are applied on fresh deploy" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].select_permissions | map(.role) | sort) == ["guest","host"]' \
    "$STATE/applied.json"
assert_jq "omitted object and array relationships are applied" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | (.object_relationships | map(.name)) == ["host"] and (.array_relationships | map(.name)) == ["images"])' \
    "$STATE/applied.json"
assert_jq "event triggers are deployed with the table" \
    '[.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].event_triggers[0].name == "on_apartment_created"' \
    "$STATE/applied.json"
assert_jq "other tenant sources are preserved" \
    '([.sources[] | select(.name=="hotel_industry")] | length) == 1 and ([.sources[] | select(.name=="hotel_industry")][0].tables | map(.table.name)) == ["hotels"]' \
    "$STATE/applied.json"
assert_jq "shared actions and cron triggers are preserved" \
    '.actions[0].name == "keep_action" and .cron_triggers[0].name == "keep_cron"' \
    "$STATE/applied.json"
assert_contains "$STATE/graphql-roles.log" "guest" "guest role operation is exercised"
assert_contains "$STATE/graphql-roles.log" "host" "host role operation is exercised"
assert_contains "$STATE/graphql-queries.log" "RoleOperation" "role operation is a real GraphQL query"
assert_contains "$STATE/graphql-queries.log" "role_guest_items(limit: 0)" \
    "role operation targets a limit-taking object field, not a scalar or action"
assert_not_contains "$TMP_ROOT/out-1.log" "test-admin-secret" "admin secret is not logged"

# 2. Re-deploying over already-tracked tables applies configuration changes.
jq -n --slurpfile metadata "$STATE/applied.json" \
    '{resource_version: 2, metadata: $metadata[0]}' > "$STATE/export.json"
rm -f "$STATE/applied.json"
cp "$FIXTURES/table-public_apartments.changed.json" \
    "$FIXTURES/table-public_apartments.json"
run_deploy safetrust "$TMP_ROOT/out-2.log"

assert_eq 0 "$STATUS" "re-deploy succeeds"
assert_jq "changed table configuration is applied on re-deploy" \
    '[.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].configuration.custom_name == "safetrust_apartments_v2"' \
    "$STATE/applied.json"
assert_jq "changed permission filter is applied on re-deploy" \
    '[.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].select_permissions | map(select(.role=="guest"))[0].permission.filter.is_available._eq == false' \
    "$STATE/applied.json"
assert_jq "changed relationship name is applied on re-deploy" \
    '[.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | (.object_relationships | map(.name)) == ["owner"]' \
    "$STATE/applied.json"

# 3. An unchanged re-run is idempotent.
jq -n --slurpfile metadata "$STATE/applied.json" \
    '{resource_version: 3, metadata: $metadata[0]}' > "$STATE/export.json"
before_hash=$(jq -S . "$STATE/applied.json" | cksum)
run_deploy safetrust "$TMP_ROOT/out-3.log"
after_hash=$(jq -S . "$STATE/applied.json" | cksum)

assert_eq 0 "$STATUS" "unchanged re-run succeeds"
assert_eq "$before_hash" "$after_hash" "unchanged re-run produces identical metadata"

# 3b. Keys removed from YAML disappear on re-deploy (revocation is applied).
cat > "$FIXTURES/table-public_apartments.revoked.json" <<'JSON'
{
  "table": {"name": "apartments", "schema": "safetrust"},
  "configuration": {"custom_name": "safetrust_apartments_v3"}
}
JSON
jq -n --slurpfile metadata "$STATE/applied.json" \
    '{resource_version: 4, metadata: $metadata[0]}' > "$STATE/export.json"
rm -f "$STATE/applied.json"
cp "$FIXTURES/table-public_apartments.revoked.json" \
    "$FIXTURES/table-public_apartments.json"
run_deploy safetrust "$TMP_ROOT/out-3b.log"

assert_eq 0 "$STATUS" "re-deploy after revocation succeeds"
assert_jq "removed select permissions are no longer deployed" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | has("select_permissions") | not)' \
    "$STATE/applied.json"
assert_jq "removed insert permissions are no longer deployed" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | has("insert_permissions") | not)' \
    "$STATE/applied.json"
assert_jq "removed relationships are no longer deployed" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | ((has("object_relationships") | not) and (has("array_relationships") | not)))' \
    "$STATE/applied.json"
assert_jq "removed event triggers are no longer deployed" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | has("event_triggers") | not)' \
    "$STATE/applied.json"
assert_jq "configuration keys removed from YAML are no longer deployed" \
    '([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0] | .configuration.custom_name == "safetrust_apartments_v3" and (.configuration | has("column_config") | not))' \
    "$STATE/applied.json"

# 4. Deploying one tenant preserves the other tenant's applied metadata.
reset_state
run_deploy safetrust "$TMP_ROOT/out-4a.log"
jq -n --slurpfile metadata "$STATE/applied.json" \
    '{resource_version: 2, metadata: $metadata[0]}' > "$STATE/export.json"
add_hotel_build
rm -f "$STATE/applied.json"
run_deploy hotel_industry "$TMP_ROOT/out-4b.log"

assert_eq 0 "$STATUS" "deploying the second tenant succeeds"
assert_jq "second tenant configuration is applied" \
    '[.sources[] | select(.name=="hotel_industry")][0].tables | map(select(.table.name=="hotels"))[0].configuration.custom_name == "hotel_industry_hotels"' \
    "$STATE/applied.json"
assert_jq "first tenant permissions survive the second tenant deploy" \
    '[.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].select_permissions | map(.role) | sort == ["guest","host"]' \
    "$STATE/applied.json"

# 5. A failed metadata API response is explicit and does not look like success.
reset_state
cat > "$STATE/fail-replace" <<'JSON'
{"error":"permission denied","code":"access-denied","path":"$.args"}
JSON
run_deploy safetrust "$TMP_ROOT/out-5.log"

if [[ "$STATUS" -ne 0 ]]; then
    pass "failed replace_metadata exits non-zero"
else
    fail_test "failed replace_metadata exits non-zero"
fi
assert_contains "$TMP_ROOT/out-5.log" "replace_metadata" "failed API output names the operation"
assert_contains "$TMP_ROOT/out-5.log" "permission denied" "failed API output includes the server error"
if [[ ! -f "$STATE/applied.json" ]]; then
    pass "failed replace_metadata does not record applied metadata"
else
    fail_test "failed replace_metadata does not record applied metadata"
fi

# 5b. The replacement is pinned to the exported resource_version, so a
#     concurrent write between export and replace fails instead of being
#     silently overwritten.
reset_state
run_deploy safetrust "$TMP_ROOT/out-5b-a.log"
assert_eq 0 "$STATUS" "deploy with optimistic concurrency succeeds"
if jq -e '.args.resource_version == 1' "$STATE/replace-payloads.jsonl" >/dev/null 2>&1; then
    pass "replacement carries the exported resource_version"
else
    fail_test "replacement carries the exported resource_version"
fi

reset_state
cat > "$STATE/conflict-replace" <<'JSON'
{}
JSON
run_deploy safetrust "$TMP_ROOT/out-5b.log"

if [[ "$STATUS" -ne 0 ]]; then
    pass "a resource_version conflict exits non-zero"
else
    fail_test "a resource_version conflict exits non-zero"
fi
assert_contains "$TMP_ROOT/out-5b.log" "did not match current version" \
    "conflict diagnostics include the server message"
assert_contains "$TMP_ROOT/out-5b.log" "re-run the deployment" \
    "conflict diagnostics explain how to recover"

# 6. Pending migrations block dependent metadata before any replacement.
reset_state
printf 'Migrations:\n  1731908059919_create_uuid_extension  Pending\n' \
    > "$STATE/migrate-status.txt"
run_deploy safetrust "$TMP_ROOT/out-6.log"

if [[ "$STATUS" -ne 0 ]]; then
    pass "pending migrations fail the deployment"
else
    fail_test "pending migrations fail the deployment"
fi
assert_contains "$TMP_ROOT/out-6.log" "Migrations are not fully applied" \
    "pending migration diagnostics are explicit"
if [[ ! -f "$STATE/applied.json" ]]; then
    pass "metadata is not applied when migrations are pending"
else
    fail_test "metadata is not applied when migrations are pending"
fi

# 7. Inconsistent metadata after deployment is detected and reported.
reset_state
cat > "$STATE/inconsistent.json" <<'JSON'
{
  "is_consistent": false,
  "inconsistent_objects": [
    {"type": "table", "name": "apartments", "reason": "table not found"}
  ]
}
JSON
run_deploy safetrust "$TMP_ROOT/out-7.log"

if [[ "$STATUS" -ne 0 ]]; then
    pass "inconsistent metadata fails the deployment"
else
    fail_test "inconsistent metadata fails the deployment"
fi
assert_contains "$TMP_ROOT/out-7.log" "Metadata is inconsistent" \
    "inconsistent metadata diagnostics are explicit"

# 8. A failing representative role operation fails the deployment.
reset_state
cat > "$STATE/fail-graphql-role-guest" <<'JSON'
{"errors":[{"message":"field 'role_guest_items' not found in type: 'query_root'"}]}
JSON
run_deploy safetrust "$TMP_ROOT/out-8.log"

if [[ "$STATUS" -ne 0 ]]; then
    pass "failing guest role verification fails the deployment"
else
    fail_test "failing guest role verification fails the deployment"
fi
assert_contains "$TMP_ROOT/out-8.log" "role 'guest'" \
    "role verification failure names the role"

# 9. A completely fresh endpoint (no sources) accepts the first source.
reset_state
printf '%s\n' '{"resource_version": 1, "metadata": {"version": 3, "sources": []}}' \
    > "$STATE/export.json"
run_deploy safetrust "$TMP_ROOT/out-9.log"

assert_eq 0 "$STATUS" "fresh endpoint deploy succeeds"
assert_jq "fresh endpoint gains the tenant source, permissions, and relationships" \
    '([.sources[] | select(.name=="safetrust")] | length) == 1 and ([.sources[] | select(.name=="safetrust")][0].tables | map(select(.table.name=="apartments"))[0].select_permissions | length) == 2' \
    "$STATE/applied.json"

echo
echo "passed: $PASS, failed: $FAIL"
if [[ "$FAIL" -ne 0 ]]; then
    exit 1
fi
