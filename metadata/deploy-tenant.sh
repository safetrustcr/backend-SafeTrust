#!/usr/bin/env bash
set -eo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# deploy-tenant.sh
# Deploys complete Hasura metadata for one or more tenants.
#
# The previous implementation only registered sources, tracked tables, and
# tracked functions. It intentionally skipped tables/functions that were
# already tracked, so permissions, relationships, table configuration, and
# event triggers from YAML were never applied after the first run.
#
# This script instead:
#   1. validates migration state for the tenant,
#   2. exports the endpoint's complete metadata document,
#   3. merges this tenant's built table/function definitions (including
#      configuration, permissions, relationships, and event triggers) into
#      that document, preserving every other source and all shared metadata,
#   4. replaces the document atomically,
#   5. checks for inconsistent metadata, and
#   6. exercises representative guest/host GraphQL operations.
#
# Metadata replacement is serialized per endpoint because replace_metadata is
# a whole-document operation: two concurrent tenant deploys could otherwise
# export the same pre-deploy state and erase each other's changes.
#
# Usage:
#   ./deploy-tenant.sh <tenant1> [tenant2 ...] [options]
#
# Options:
#   --endpoint URL          Hasura endpoint (default: HASURA_ENDPOINT or
#                           http://localhost:8080)
#   --admin-secret SECRET   Admin secret (default: HASURA_GRAPHQL_ADMIN_SECRET)
#   --verify-roles "ROLES"  Roles to smoke-test (default: "guest host")
#   -h, --help              Show this help
#
# Environment:
#   HASURA_ENDPOINT             Default Hasura endpoint
#   HASURA_GRAPHQL_ADMIN_SECRET Admin secret
#   BUILD_DIR                   Build output directory (default: metadata/build)
#   HASURA_VERIFY_ROLES         Roles to smoke-test (default: "guest host";
#                               set to an empty string to skip role checks)
#   DEPLOY_LOCK_TIMEOUT         Seconds to wait for the metadata lock (default 180)
#
# Cloud target example (no secrets are written to logs):
#   HASURA_GRAPHQL_ADMIN_SECRET=... ./deploy-tenant.sh safetrust \
#     --endpoint https://<project>.hasura.app
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$SCRIPT_DIR/build}"
HASURA_ENDPOINT="${HASURA_ENDPOINT:-http://localhost:8080}"
HASURA_ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-myadminsecretkey}"
HASURA_VERIFY_ROLES="${HASURA_VERIFY_ROLES:-guest host}"
DEPLOY_LOCK_TIMEOUT="${DEPLOY_LOCK_TIMEOUT:-180}"

LOCK_DIR=""

cleanup() {
    if [[ -n "$LOCK_DIR" ]]; then
        rm -rf "$LOCK_DIR"
    fi
}

fail() {
    echo "❌ $*" >&2
    return 1
}

# Serialize whole-document metadata replacements for the same endpoint.
acquire_deploy_lock() {
    local lock_base
    lock_base="${TMPDIR:-/tmp}/safetrust-metadata-$(printf '%s' "$HASURA_ENDPOINT" | cksum | awk '{print $1}')"

    if command -v flock >/dev/null 2>&1; then
        exec 9>"${lock_base}.lock"
        if ! flock -w "$DEPLOY_LOCK_TIMEOUT" 9; then
            fail "Timed out after ${DEPLOY_LOCK_TIMEOUT}s waiting for another metadata deployment to ${HASURA_ENDPOINT}."
            return 1
        fi
        return 0
    fi

    # Portable fallback for hosts without flock.
    LOCK_DIR="${lock_base}.lock.d"
    local waited=0
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
        if [[ -f "$LOCK_DIR/pid" ]]; then
            local holder
            holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
            if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
                rm -rf "$LOCK_DIR"
                continue
            fi
        fi
        if (( waited >= DEPLOY_LOCK_TIMEOUT )); then
            fail "Timed out after ${DEPLOY_LOCK_TIMEOUT}s waiting for another metadata deployment to ${HASURA_ENDPOINT}."
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done

    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    trap cleanup EXIT
}

# ─────────────────────────────────────────────────────────────────────────────
# load_source_definition
# Reads the tenant's built databases.yaml and strips CLI-only !include fields.
# ─────────────────────────────────────────────────────────────────────────────
load_source_definition() {
    local tenant="$1"
    local databases_file="$BUILD_DIR/$tenant/databases/databases.yaml"

    if [[ ! -f "$databases_file" ]]; then
        fail "No databases.yaml found at $databases_file. Run build-metadata.sh first."
        return 1
    fi

    if ! yq -o json e '.' "$databases_file" | jq -c '
        (if type == "array" then .[0] else . end)
        | select(type == "object" and (.name // "") != "")
        | del(.tables, .functions)
    '; then
        fail "Failed to read source definition for tenant '$tenant' from $databases_file."
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# load_table_definitions
# Every table YAML file is part of the metadata document. This keeps table
# configuration, permissions, relationships, and event triggers intact.
# ─────────────────────────────────────────────────────────────────────────────
load_table_definitions() {
    local tenant="$1"
    local tables_dir="$BUILD_DIR/$tenant/databases/tables"
    local -a table_files=()

    if [[ ! -d "$tables_dir" ]]; then
        echo '[]'
        return 0
    fi

    while IFS= read -r -d '' file; do
        case "$(basename "$file")" in
            tables.yaml) continue ;;
            *) table_files+=("$file") ;;
        esac
    done < <(find "$tables_dir" -maxdepth 1 -type f -name '*.yaml' -print0 | LC_ALL=C sort -z)

    if [[ ${#table_files[@]} -eq 0 ]]; then
        echo '[]'
        return 0
    fi

    if ! yq -o json e '.' "${table_files[@]}" | jq -s -c '
        map(if type == "array" then .[] else . end)
        | map(select(type == "object"))
        | map(select((.table.name? // "") != ""))
    '; then
        fail "Failed to read table metadata for tenant '$tenant'."
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# load_function_definitions
# Keeps function metadata, but drops SQL "definition" blocks which are not
# part of Hasura metadata, and normalizes permissions to the API shape.
# ─────────────────────────────────────────────────────────────────────────────
load_function_definitions() {
    local tenant="$1"
    local functions_dir="$BUILD_DIR/$tenant/databases/functions"
    local -a function_files=()

    if [[ ! -d "$functions_dir" ]]; then
        echo '[]'
        return 0
    fi

    while IFS= read -r -d '' file; do
        case "$(basename "$file")" in
            functions.yaml) continue ;;
            *) function_files+=("$file") ;;
        esac
    done < <(find "$functions_dir" -maxdepth 1 -type f -name '*.yaml' -print0 | LC_ALL=C sort -z)

    if [[ ${#function_files[@]} -eq 0 ]]; then
        echo '[]'
        return 0
    fi

    if ! yq -o json e '.' "${function_files[@]}" | jq -s -c '
        map(if type == "array" then .[] else . end)
        | map(select(type == "object"))
        | map(
            if (.function.name? // "") != "" then .
            elif (.name? // "") != "" then
                {function: {name: .name, schema: (.schema // "public")}}
                + (del(.name, .schema))
            else empty end
          )
        | map(
            {function: .function}
            + {
                configuration: (
                    (.configuration // {})
                    | if has("exposed_as") then . else . + {exposed_as: "query"} end
                )
              }
            + (if .comment then {comment: .comment} else {} end)
            + (
                if .permissions then
                    {
                        permissions: (
                            .permissions
                            | map(if type == "object" then {role: (.role // empty)} else empty end)
                            | map(select((.role // "") != ""))
                        )
                    }
                else {} end
              )
          )
    '; then
        fail "Failed to read function metadata for tenant '$tenant'."
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# validate_migrations
# Permissions and relationships can only be applied to tables that exist.
# Refuse to touch metadata until every migration for this tenant is applied.
# ─────────────────────────────────────────────────────────────────────────────
validate_migrations() {
    local tenant="$1"
    local status_output

    echo "🔍 [$tenant] Validating migration state against $HASURA_ENDPOINT..." >&2

    if ! status_output=$(hasura migrate status \
        --project "$ROOT_DIR" \
        --endpoint "$HASURA_ENDPOINT" \
        --admin-secret "$HASURA_ADMIN_SECRET" \
        --database-name "$tenant" \
        --disable-interactive \
        --no-color \
        --skip-update-check 2>&1); then
        echo "❌ [$tenant] Could not read migration state; refusing to deploy metadata." >&2
        echo "$status_output" >&2
        return 1
    fi

    # Only the trailing DATABASE STATUS column gates deployment. A
    # "Not Present" SOURCE STATUS on a remote-only migration must not block a
    # deploy when the target database is already up to date.
    if grep -qE '(Pending|Not Present|Not Applied)[[:space:]]*$' <<<"$status_output"; then
        echo "❌ [$tenant] Migrations are not fully applied; refusing to deploy dependent metadata." >&2
        echo "$status_output" >&2
        return 1
    fi

    echo "✅ [$tenant] Migration state is up to date" >&2
}

# ─────────────────────────────────────────────────────────────────────────────
# metadata_api
# Calls /v1/metadata, validates HTTP status and JSON, and prints the response.
# ─────────────────────────────────────────────────────────────────────────────
metadata_api() {
    local operation="$1"
    local payload="$2"
    local response_file error_file http_code body

    response_file=$(mktemp)
    error_file=$(mktemp)

    if ! http_code=$(curl -sS -o "$response_file" -w '%{http_code}' \
        -X POST "${HASURA_ENDPOINT}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
        -H "Content-Type: application/json" \
        -d "$payload" 2>"$error_file"); then
        echo "❌ Metadata API request '$operation' failed: $(cat "$error_file")" >&2
        rm -f "$response_file" "$error_file"
        return 1
    fi

    body=$(cat "$response_file")
    rm -f "$response_file" "$error_file"

    if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
        echo "❌ Metadata API request '$operation' returned HTTP $http_code." >&2
        echo "$body" >&2
        return 1
    fi

    if ! jq -e . >/dev/null 2>&1 <<<"$body"; then
        echo "❌ Metadata API request '$operation' returned invalid JSON." >&2
        echo "$body" >&2
        return 1
    fi

    if jq -e 'type == "object" and has("error")' >/dev/null 2>&1 <<<"$body"; then
        echo "❌ Metadata API request '$operation' returned an error." >&2
        echo "$body" >&2
        return 1
    fi

    printf '%s' "$body"
}

# ─────────────────────────────────────────────────────────────────────────────
# graphql_as_role
# Runs a GraphQL operation with the admin secret plus X-Hasura-Role, which
# exercises the role's actual permissions rather than admin introspection.
# ─────────────────────────────────────────────────────────────────────────────
graphql_as_role() {
    local role="$1"
    local query="$2"
    local payload response_file error_file http_code body

    payload=$(jq -cn --arg query "$query" '{query: $query}')
    response_file=$(mktemp)
    error_file=$(mktemp)

    if ! http_code=$(curl -sS -o "$response_file" -w '%{http_code}' \
        -X POST "${HASURA_ENDPOINT}/v1/graphql" \
        -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
        -H "X-Hasura-Role: ${role}" \
        -H "Content-Type: application/json" \
        -d "$payload" 2>"$error_file"); then
        echo "❌ GraphQL request for role '$role' failed: $(cat "$error_file")" >&2
        rm -f "$response_file" "$error_file"
        return 1
    fi

    body=$(cat "$response_file")
    rm -f "$response_file" "$error_file"

    if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]] \
        || ! jq -e '((.errors // []) | length) == 0' >/dev/null 2>&1 <<<"$body"; then
        echo "❌ GraphQL request for role '$role' failed (HTTP $http_code)." >&2
        echo "$body" >&2
        return 1
    fi

    printf '%s' "$body"
}

# ─────────────────────────────────────────────────────────────────────────────
# merge_metadata_document
# Merges the tenant's desired objects into the exported document.
# Tables/functions that are not defined in this tenant's YAML are preserved,
# and every other source plus all shared metadata stays untouched.
# ─────────────────────────────────────────────────────────────────────────────
merge_metadata_document() {
    local exported="$1"
    local source_name="$2"
    local source_definition="$3"
    local table_definitions="$4"
    local function_definitions="$5"

    jq -c \
        --arg source "$source_name" \
        --argjson source_definition "$source_definition" \
        --argjson desired_tables "$table_definitions" \
        --argjson desired_functions "$function_definitions" '
        def merge_tables($existing; $desired):
            # The table YAML is the complete definition, so a matching entry is
            # replaced rather than merged: keys removed from YAML (a revoked
            # permission, an event trigger, a relationship) must disappear.
            $desired as $updated
            | $updated + (($existing // []) | map(
                . as $e
                | select(
                    ($desired | map(
                        select(
                            .table.name == $e.table.name
                            and ((.table.schema // "public") == ($e.table.schema // "public"))
                        )
                    ) | length) == 0
                  )
              ));

        def merge_functions($existing; $desired):
            # Same rule as tables: the YAML is the complete function definition,
            # so a matching entry is replaced instead of deep-merged.
            $desired as $updated
            | $updated + (($existing // []) | map(
                . as $e
                | select(
                    ($desired | map(
                        select(
                            .function.name == $e.function.name
                            and ((.function.schema // "public") == ($e.function.schema // "public"))
                        )
                    ) | length) == 0
                  )
              ));

        (.metadata // .) as $document
        | ($document.sources // []) as $sources
        | ([$sources[]? | select(.name == $source)] | first // null) as $existing_source
        | (
            (($existing_source // {}) | del(.tables, .functions))
            * ($source_definition | del(.tables, .functions))
          ) as $merged_source
        | $merged_source
        | .tables = merge_tables(($existing_source.tables // []); $desired_tables)
        | .functions = merge_functions(($existing_source.functions // []); $desired_functions)
        | . as $target
        | $document
        | (if has("version") then . else . + {version: 3} end)
        | .sources = (($sources | map(select(.name != $source))) + [$target])
    ' <<<"$exported"
}

# ─────────────────────────────────────────────────────────────────────────────
# deploy_full_metadata
# ─────────────────────────────────────────────────────────────────────────────
deploy_full_metadata() {
    local tenant="$1"
    local source_name="$2"
    local source_definition="$3"
    local table_definitions="$4"
    local function_definitions="$5"
    local exported merged payload consistency table_count function_count

    table_count=$(jq 'length' <<<"$table_definitions")
    function_count=$(jq 'length' <<<"$function_definitions")

    echo "📤 [$tenant] Exporting current metadata from $HASURA_ENDPOINT..." >&2
    if ! exported=$(metadata_api "export_metadata" '{"type":"export_metadata","args":{}}'); then
        return 1
    fi

    if ! merged=$(merge_metadata_document \
        "$exported" \
        "$source_name" \
        "$source_definition" \
        "$table_definitions" \
        "$function_definitions"); then
        fail "[$tenant] Failed to merge tenant metadata into the exported document."
        return 1
    fi
    if [[ -z "$merged" ]] || ! jq -e . >/dev/null 2>&1 <<<"$merged"; then
        fail "[$tenant] Metadata merge produced an empty or invalid document."
        return 1
    fi

    echo "🧩 [$tenant] Applying complete metadata for source '$source_name' (${table_count} table(s), ${function_count} function(s))..." >&2
    payload=$(jq -cn \
        --argjson metadata "$merged" \
        '{type: "replace_metadata", args: {metadata: $metadata, allow_inconsistent_metadata: false}}')

    if ! metadata_api "replace_metadata" "$payload" >/dev/null; then
        echo "❌ [$tenant] Metadata replacement failed; the endpoint keeps its previous metadata." >&2
        return 1
    fi

    echo "🔎 [$tenant] Checking metadata consistency..." >&2
    if ! consistency=$(metadata_api "get_inconsistent_metadata" '{"type":"get_inconsistent_metadata","args":{}}'); then
        return 1
    fi

    if ! jq -e '.is_consistent == true and ((.inconsistent_objects // []) | length) == 0' \
        >/dev/null 2>&1 <<<"$consistency"; then
        echo "❌ [$tenant] Metadata is inconsistent after deployment:" >&2
        jq . <<<"$consistency" >&2 || echo "$consistency" >&2
        return 1
    fi

    echo "✅ [$tenant] Metadata applied and consistent" >&2
}

# ─────────────────────────────────────────────────────────────────────────────
# verify_role_operations
# Runs a real query as each representative role (guest/host by default).
# ─────────────────────────────────────────────────────────────────────────────
verify_role_operations() {
    local tenant="$1"
    local verified=0
    local role field schema_response

    if [[ -z "${HASURA_VERIFY_ROLES// /}" ]]; then
        echo "⚠️  [$tenant] Role verification disabled (HASURA_VERIFY_ROLES is empty)." >&2
        return 0
    fi

    echo "🔐 [$tenant] Verifying representative role schemas: $HASURA_VERIFY_ROLES" >&2

    for role in $HASURA_VERIFY_ROLES; do
        if ! schema_response=$(graphql_as_role "$role" \
            'query RoleSchema { __schema { queryType { fields { name type { kind ofType { kind ofType { kind ofType { kind } } } } args { name type { kind } defaultValue } } } } }'); then
            echo "❌ [$tenant] Could not introspect the schema as role '$role'." >&2
            return 1
        fi

        field=$(jq -r '
            [
                .data.__schema.queryType.fields[]?
                | select(.name | startswith("__") | not)
                # Only fields that accept `limit` can be probed with limit: 0.
                | select(any(.args[]?; .name == "limit"))
                | select(
                    [.args[]? | select(.type.kind == "NON_NULL" and .defaultValue == null)]
                    | length == 0
                  )
                # A selection set is only valid on composite (object) results;
                # scalar fields, actions rows aside, would make the query invalid.
                | select(
                    (def leaf_kind:
                        if (.ofType // null) == null then .kind
                        else (.ofType | leaf_kind)
                        end;
                     .type | leaf_kind) as $kind
                    | $kind == "OBJECT" or $kind == "INTERFACE"
                  )
                | .name
            ]
            | first // empty
        ' <<<"$schema_response")

        if [[ -z "$field" ]]; then
            echo "❌ [$tenant] Role '$role' exposes no queryable fields; cannot verify permissions." >&2
            return 1
        fi

        if [[ ! "$field" =~ ^[_A-Za-z][_0-9A-Za-z]*$ ]]; then
            echo "❌ [$tenant] Refusing to query unexpected field name '$field' for role '$role'." >&2
            return 1
        fi

        if ! graphql_as_role "$role" \
            "query RoleOperation { ${field}(limit: 0) { __typename } }" >/dev/null; then
            echo "❌ [$tenant] Role '$role' operation on '$field' failed." >&2
            return 1
        fi

        echo "✅ [$tenant] Role '$role' can query '$field'" >&2
        verified=$((verified + 1))
    done

    if [[ "$verified" -eq 0 ]]; then
        fail "[$tenant] No representative role operations were verified."
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# deploy_tenant
# ─────────────────────────────────────────────────────────────────────────────
deploy_tenant() {
    local tenant="$1"
    local tenant_start=$SECONDS
    local source_definition source_name table_definitions function_definitions

    echo "===========================================" >&2
    echo "Deploying complete metadata for tenant: $tenant" >&2
    echo "===========================================" >&2

    if [[ ! -d "$BUILD_DIR/$tenant" ]]; then
        fail "No metadata found for tenant '$tenant' at $BUILD_DIR/$tenant. Run build-metadata.sh first."
        return 1
    fi

    if ! source_definition=$(load_source_definition "$tenant"); then
        return 1
    fi
    source_name=$(jq -r '.name' <<<"$source_definition")

    if ! table_definitions=$(load_table_definitions "$tenant"); then
        return 1
    fi
    if ! function_definitions=$(load_function_definitions "$tenant"); then
        return 1
    fi

    if [[ "$(jq 'length' <<<"$table_definitions")" -eq 0 ]]; then
        echo "⚠️  [$tenant] No table definitions found in the build output." >&2
    fi

    validate_migrations "$tenant" || return 1
    deploy_full_metadata "$tenant" "$source_name" "$source_definition" \
        "$table_definitions" "$function_definitions" || return 1
    verify_role_operations "$tenant" || return 1

    local tenant_elapsed=$(( SECONDS - tenant_start ))
    echo "⏱️  Deploy time for $tenant: ${tenant_elapsed}s" >&2
}

usage() {
    cat <<'USAGE'
Usage: ./deploy-tenant.sh <tenant1> [tenant2 ...] [options]

Applies complete Hasura metadata — source, table configuration, permissions,
relationships, and event triggers — by exporting the current metadata,
merging this tenant's build output, and replacing the full document. Other
tenants' sources and shared metadata are preserved.

Options:
  --endpoint URL          Hasura endpoint (default: HASURA_ENDPOINT or
                          http://localhost:8080)
  --admin-secret SECRET   Admin secret (default: HASURA_GRAPHQL_ADMIN_SECRET)
  --verify-roles "ROLES"  Roles to smoke-test (default: "guest host")
  -h, --help              Show this help

Cloud target (explicit endpoint; secrets are read from the environment):
  HASURA_GRAPHQL_ADMIN_SECRET=... ./deploy-tenant.sh safetrust \
    --endpoint https://<project>.hasura.app
USAGE
}

# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────
main() {
    local tenants=()
    local deploy_start=$SECONDS

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --admin-secret)
                if [[ -z "${2:-}" ]]; then
                    fail "--admin-secret requires a value."
                    exit 1
                fi
                HASURA_ADMIN_SECRET="$2"
                shift 2
                ;;
            --endpoint)
                if [[ -z "${2:-}" ]]; then
                    fail "--endpoint requires a value."
                    exit 1
                fi
                HASURA_ENDPOINT="$2"
                shift 2
                ;;
            --verify-roles)
                if [[ $# -lt 2 ]]; then
                    fail "--verify-roles requires a value (use \"\" to disable)."
                    exit 1
                fi
                HASURA_VERIFY_ROLES="$2"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            -*)
                fail "Unknown option: $1"
                usage >&2
                exit 1
                ;;
            *)
                tenants+=("$1")
                shift
                ;;
        esac
    done

    if [[ ${#tenants[@]} -eq 0 ]]; then
        usage >&2
        exit 1
    fi

    HASURA_ENDPOINT="${HASURA_ENDPOINT%/}"
    case "$HASURA_ENDPOINT" in
        http://*|https://*) ;;
        *)
            fail "Invalid endpoint '$HASURA_ENDPOINT'. Expected an http:// or https:// URL."
            exit 1
            ;;
    esac

    if [[ -z "$HASURA_ADMIN_SECRET" ]]; then
        fail "Hasura admin secret is required via --admin-secret or HASURA_GRAPHQL_ADMIN_SECRET."
        exit 1
    fi

    echo "Deploying complete metadata for tenants: ${tenants[*]}"
    echo "Endpoint: $HASURA_ENDPOINT"

    acquire_deploy_lock || exit 1

    local successful_tenants=()
    local failed_tenants=()

    for tenant in "${tenants[@]}"; do
        if deploy_tenant "$tenant"; then
            successful_tenants+=("$tenant")
        else
            failed_tenants+=("$tenant")
        fi
    done

    local total_elapsed=$(( SECONDS - deploy_start ))

    echo ""
    echo "====== DEPLOYMENT SUMMARY ======"
    echo "Total tenants processed:  ${#tenants[@]}"
    echo "Successful deployments:   ${#successful_tenants[@]}"
    echo "Failed deployments:       ${#failed_tenants[@]}"
    echo "Total deploy time:        ${total_elapsed}s"

    if [[ ${#successful_tenants[@]} -gt 0 ]]; then
        echo "Successfully deployed tenants: ${successful_tenants[*]}"
    fi

    if [[ ${#failed_tenants[@]} -gt 0 ]]; then
        echo "❌ Failed to deploy tenants: ${failed_tenants[*]}"
        exit 1
    fi

    echo "🎉 All tenants deployed successfully!"
}

main "$@"
