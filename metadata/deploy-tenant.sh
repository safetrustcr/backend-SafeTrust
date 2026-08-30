#!/usr/bin/env bash
set -eo pipefail

# Configuration — paths relative to the script location, matching build-metadata.sh
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${BUILD_DIR:-$SCRIPT_DIR/build}"
HASURA_ENDPOINT="http://localhost:8080"
HASURA_ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-myadminsecretkey}"

# ─────────────────────────────────────────────────────────────────────────────
# create_metadata_source
# All log output goes to stderr — only tenant_name goes to stdout
# ─────────────────────────────────────────────────────────────────────────────
create_metadata_source() {
    local tenant="$1"
    local temp_dir="$2"
    local hasura_endpoint="$3"
    local admin_secret="$4"

    echo "===========================================" >&2
    echo "Deploying metadata for tenant: $tenant" >&2
    echo "===========================================" >&2

    if [ ! -d "$BUILD_DIR/$tenant" ]; then
        echo "❌ Error: No metadata found for tenant '$tenant'. Run build-metadata.sh first." >&2
        return 1
    fi

    mkdir -p "$temp_dir/metadata/databases/default/tables"
    mkdir -p "$temp_dir/metadata/databases/default/functions"

    cat > "$temp_dir/config.yaml" << EOL
version: 3
endpoint: ${hasura_endpoint}
admin_secret: ${admin_secret}
metadata_directory: metadata
EOL

    if [ -d "$BUILD_DIR/$tenant/databases/tables" ]; then
        echo "Copying table definitions for $tenant..." >&2
        cp -r "$BUILD_DIR/$tenant/databases/tables"/* \
            "$temp_dir/metadata/databases/default/tables/"
    else
        echo "⚠️  Warning: No tables directory found at $BUILD_DIR/$tenant/databases/tables/" >&2
    fi

    if [ -d "$BUILD_DIR/$tenant/databases/functions" ]; then
        echo "Copying function definitions for $tenant..." >&2
        cp -r "$BUILD_DIR/$tenant/databases/functions"/* \
            "$temp_dir/metadata/databases/default/functions/"
    fi

    local tenant_name
    if [ -f "$BUILD_DIR/$tenant/databases/databases.yaml" ]; then
        tenant_name=$(grep -m 1 "name:" "$BUILD_DIR/$tenant/databases/databases.yaml" \
            | sed 's/.*name:\s*\([^ ]*\).*/\1/')
        echo "Found tenant name in databases.yaml: $tenant_name" >&2
    else
        tenant_name="$tenant"
        echo "No databases.yaml found, using tenant name: $tenant_name" >&2
    fi

    # Robust source existence check: list configured sources and test membership
    # with jq, instead of matching the string "error" in a response body.
    echo "Checking if source ${tenant_name} already exists..." >&2
    local sources_resp
    sources_resp=$(curl -sS -X POST "${hasura_endpoint}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${admin_secret}" \
        -H "Content-Type: application/json" \
        -d '{"type": "export_metadata", "args": {}}')

    if echo "$sources_resp" | jq -e --arg n "$tenant_name" \
        '(.metadata.sources? // []) | any(.name == $n)' >/dev/null 2>&1; then
        echo "Source $tenant_name already exists, skipping creation" >&2
    else
        echo "Source $tenant_name doesn't exist, creating it..." >&2
        local source_file
        local source_code
        source_file=$(mktemp)
        source_code=$(curl -sS -o "$source_file" -w '%{http_code}' \
            -X POST "${hasura_endpoint}/v1/metadata" \
            -H "X-Hasura-Admin-Secret: ${admin_secret}" \
            -H "Content-Type: application/json" \
            -d "{
                \"type\": \"pg_add_source\",
                \"args\": {
                    \"name\": \"${tenant_name}\",
                    \"configuration\": {
                        \"connection_info\": {
                            \"database_url\": {\"from_env\": \"PG_DATABASE_URL\"},
                            \"isolation_level\": \"read-committed\",
                            \"use_prepared_statements\": false
                        }
                    }
                }
            }")
        local source_body
        source_body=$(cat "$source_file")
        rm -f "$source_file"

        if [ "$source_code" != "200" ] || echo "$source_body" | jq -e 'type == "object" and has("error")' >/dev/null 2>&1; then
            echo "❌ Failed to create source for $tenant_name" >&2
            echo "Error: $source_body" >&2
            return 1
        fi
    fi

    echo "✅ Tenant source created/verified: $tenant_name" >&2
    echo "$tenant_name"
}

# ─────────────────────────────────────────────────────────────────────────────
# process_metadata_tables
# Bulk-tracks all tables in a single pg_track_tables call per tenant.
# -----------------------------------------------------------------------------
process_metadata_tables() {
    local tenant="$1"
    local tenant_name="$2"
    local temp_dir="$3"
    local hasura_endpoint="$4"
    local admin_secret="$5"

    echo "⚙️  Processing tables for $tenant_name..."

    local tables_dir="$temp_dir/metadata/databases/default/tables"
    if [ ! -d "$tables_dir" ]; then
        echo "⚠️  No tables directory found, skipping table tracking"
        return 0
    fi

    local table_files=()
    while IFS= read -r -d '' f; do
        case "$(basename "$f")" in
            tables.yaml | functions.yaml) continue ;;
            *) table_files+=("$f") ;;
        esac
    done < <(find "$tables_dir" -maxdepth 1 -type f -name '*.yaml' -print0)

    if [ "${#table_files[@]}" -eq 0 ]; then
        echo "⚠️  No table definitions found for $tenant_name"
        return 0
    fi

    # One yq pass over all table YAML, then a single jq pass to shape the args.
    local tables_json
    tables_json=$(yq -o json e '.' "${table_files[@]}" 2>/dev/null \
        | jq -s 'map(select(type == "object" and ((.table.name? // "") != ""))) | map({ table: { name: .table.name, schema: (.table.schema // "public") }, configuration: (.configuration // {}) })') || {
        echo "❌ Failed to read table metadata for $tenant_name" >&2
        return 1
    }

    if [ -z "$tables_json" ] || [ "$tables_json" = "[]" ] || [ "$tables_json" = "null" ]; then
        echo "⚠️  No trackable tables found for $tenant_name"
        return 0
    fi

    local track_payload
    track_payload=$(jq -cn --arg source "$tenant_name" --argjson tables "$tables_json" \
        '{type:"pg_track_tables", args:{source:$source, tables:$tables}}')

    echo "🔎 Bulk-tracking tables for $tenant_name..."
    local track_response
    track_response=$(curl -sS -X POST "${hasura_endpoint}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${admin_secret}" \
        -H "Content-Type: application/json" \
        -d "$track_payload")

    if echo "$track_response" | jq -e 'type == "object" and has("error")' >/dev/null 2>&1; then
        echo "❌ Error tracking tables for $tenant_name: $track_response"
        return 1
    fi

    echo "✅ Successfully tracked tables for $tenant_name"
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# process_metadata_functions
# Bulk-tracks all functions in a single pg_track_functions call per tenant.
# -----------------------------------------------------------------------------
process_metadata_functions() {
    local tenant="$1"
    local tenant_name="$2"
    local temp_dir="$3"
    local hasura_endpoint="$4"
    local admin_secret="$5"

    local functions_dir="$temp_dir/metadata/databases/default/functions"
    if [ ! -d "$functions_dir" ]; then
        return 0
    fi

    echo "⚙️  Processing functions for $tenant_name..."

    local function_files=()
    while IFS= read -r -d '' f; do
        case "$(basename "$f")" in
            tables.yaml | functions.yaml) continue ;;
            *) function_files+=("$f") ;;
        esac
    done < <(find "$functions_dir" -maxdepth 1 -type f -name '*.yaml' -print0)

    if [ "${#function_files[@]}" -eq 0 ]; then
        echo "⚠️  No function definitions found for $tenant_name"
        return 0
    fi

    local functions_json
    functions_json=$(yq -o json e '.' "${function_files[@]}" 2>/dev/null \
        | jq -s 'map(select(type == "array") | .[]) | map(select((.name? // "") != "")) | map({ function: { name: .name, schema: (.schema // "public") }, configuration: ((.configuration // {}) + { exposed_as: (.configuration.exposed_as // "query") }) })') || {
        echo "❌ Failed to read function metadata for $tenant_name" >&2
        return 1
    }

    if [ -z "$functions_json" ] || [ "$functions_json" = "[]" ] || [ "$functions_json" = "null" ]; then
        echo "⚠️  No trackable functions found for $tenant_name"
        return 0
    fi

    local track_payload
    track_payload=$(jq -cn --arg source "$tenant_name" --argjson functions "$functions_json" \
        '{type:"pg_track_functions", args:{source:$source, functions:$functions}}')

    echo "🔎 Bulk-tracking functions for $tenant_name..."
    local track_response
    track_response=$(curl -sS -X POST "${hasura_endpoint}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${admin_secret}" \
        -H "Content-Type: application/json" \
        -d "$track_payload")

    if echo "$track_response" | jq -e 'type == "object" and has("error")' >/dev/null 2>&1; then
        echo "❌ Error tracking functions for $tenant_name: $track_response"
        return 1
    fi

    echo "✅ Successfully tracked functions for $tenant_name"
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# deploy_tenant
# -----------------------------------------------------------------------------
deploy_tenant() {
    local tenant="$1"
    local hasura_endpoint="$2"
    local admin_secret="$3"
    local tenant_start=$SECONDS

    # Local temp dir only — no global TEMP_DIR, so parallel tenant deploys never
    # clobber each other's working directory.
    local temp_dir
    temp_dir=$(mktemp -d)

    local tenant_name
    if ! tenant_name=$(create_metadata_source "$tenant" "$temp_dir" "$hasura_endpoint" "$admin_secret"); then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! process_metadata_tables "$tenant" "$tenant_name" "$temp_dir" "$hasura_endpoint" "$admin_secret"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! process_metadata_functions "$tenant" "$tenant_name" "$temp_dir" "$hasura_endpoint" "$admin_secret"; then
        rm -rf "$temp_dir"
        return 1
    fi

    local tenant_elapsed=$(( SECONDS - tenant_start ))
    echo "⏱️  Deploy time for $tenant_name: ${tenant_elapsed}s"

    rm -rf "$temp_dir"
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────
main() {
    local tenants=()
    local main_start=$SECONDS

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --admin-secret) HASURA_ADMIN_SECRET="$2"; shift 2 ;;
            --endpoint)     HASURA_ENDPOINT="$2";     shift 2 ;;
            -*) echo "Unknown option: $1"; exit 1 ;;
            *)  tenants+=("$1"); shift ;;
        esac
    done

    if [ ${#tenants[@]} -eq 0 ]; then
        echo "Usage: ./deploy-tenant.sh tenant1 tenant2 ... [--admin-secret SECRET] [--endpoint URL]"
        exit 1
    fi

    echo "Deploying metadata for tenants: ${tenants[*]}"

    local successful_tenants=()
    local failed_tenants=()

    for tenant in "${tenants[@]}"; do
        if deploy_tenant "$tenant" "$HASURA_ENDPOINT" "$HASURA_ADMIN_SECRET"; then
            successful_tenants+=("$tenant")
        else
            failed_tenants+=("$tenant")
        fi
    done

    local total_elapsed=$(( SECONDS - main_start ))

    echo ""
    echo "====== DEPLOYMENT SUMMARY ======"
    echo "Total tenants processed:  ${#tenants[@]}"
    echo "Successful deployments:   ${#successful_tenants[@]}"
    echo "Failed deployments:       ${#failed_tenants[@]}"
    echo "Total deploy time:        ${total_elapsed}s"

    if [ ${#successful_tenants[@]} -gt 0 ]; then
        echo "Successfully deployed tenants: ${successful_tenants[*]}"
    fi

    if [ ${#failed_tenants[@]} -gt 0 ]; then
        echo "❌ Failed to deploy tenants: ${failed_tenants[*]}"
        exit 1
    fi

    echo "🎉 All tenants deployed successfully!"
}

main "$@"
