#!/usr/bin/env bash
set -eo pipefail

# Configuration
BUILD_DIR="$(pwd)/build"
HASURA_ENDPOINT="http://localhost:8080"
HASURA_ADMIN_SECRET="myadminsecretkey"

# Clean up temp directories on exit
cleanup() {
    if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
# create_metadata_source
# Registers the tenant as a Hasura source and copies metadata into temp_dir
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
        cp -r "$BUILD_DIR/$tenant/databases/tables"/* "$temp_dir/metadata/databases/default/tables/"
    else
        echo "⚠️  Warning: No tables directory found at $BUILD_DIR/$tenant/databases/tables/" >&2
    fi

    if [ -d "$BUILD_DIR/$tenant/databases/functions" ]; then
        echo "Copying function definitions for $tenant..." >&2
        cp -r "$BUILD_DIR/$tenant/databases/functions"/* "$temp_dir/metadata/databases/default/functions/"
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

    echo "Checking if source ${tenant_name} already exists..." >&2
    local check_source
    check_source=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${admin_secret}" \
        -H "Content-Type: application/json" \
        -d "{\"type\": \"pg_get_source_tables\", \"args\": {\"source\": \"${tenant_name}\"}}")

    if [[ "$check_source" == *"error"* ]]; then
        echo "Source $tenant_name doesn't exist, creating it..." >&2
        local source_response
        source_response=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
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

        if [[ "$source_response" == *"error"* ]]; then
            echo "❌ Failed to create source for $tenant_name" >&2
            echo "Error: $source_response" >&2
            return 1
        fi
    else
        echo "Source $tenant_name already exists, skipping creation" >&2
    fi

    echo "✅ Tenant source created/verified: $tenant_name" >&2

    # Only this line goes to stdout — captured by $() in deploy_tenant
    echo "$tenant_name"
}

# ─────────────────────────────────────────────────────────────────────────────
# process_metadata_tables
# Tracks all tables for a tenant via Hasura API
# ─────────────────────────────────────────────────────────────────────────────
process_metadata_tables() {
    local tenant="$1"
    local tenant_name="$2"
    local temp_dir="$3"
    local hasura_endpoint="$4"
    local admin_secret="$5"

    echo "⚙️  Processing tables for $tenant..."

    local tables_dir="$temp_dir/metadata/databases/default/tables"
    if [ ! -d "$tables_dir" ]; then
        echo "⚠️  No tables directory found, skipping table tracking"
        return 0
    fi

    for table_file in "$tables_dir"/*.yaml; do
        [ -f "$table_file" ] || continue

        local base_name
        base_name=$(basename "$table_file" .yaml)

        # Skip index files
        if [[ "$base_name" == "tables" ]]; then
            echo "ℹ️  Warning: Could not determine table name from $table_file, skipping"
            continue
        fi

        # Parse table name and schema using yq
        local table_name table_schema custom_name
        table_name=$(yq e '.table.name' "$table_file" 2>/dev/null | tr -d '\r')
        table_schema=$(yq e '.table.schema' "$table_file" 2>/dev/null | tr -d '\r')
        custom_name=$(yq e '.configuration.custom_name' "$table_file" 2>/dev/null | tr -d '\r')

        if [ -z "$table_schema" ] || [ "$table_schema" = "null" ]; then
            table_schema="public"
        fi

        if [ -z "$table_name" ] || [ "$table_name" = "null" ]; then
            echo "ℹ️  Warning: Could not determine table name from $table_file, skipping"
            continue
        fi

        echo "⚙️  Adding table: $table_name (schema: $table_schema) to tenant $tenant_name"

        # Build track payload — include custom_name if present
        local track_payload
        if [ -n "$custom_name" ] && [ "$custom_name" != "null" ]; then
            track_payload="{
                \"type\": \"pg_track_table\",
                \"args\": {
                    \"source\": \"${tenant_name}\",
                    \"table\": {
                        \"name\": \"${table_name}\",
                        \"schema\": \"${table_schema}\"
                    },
                    \"configuration\": {
                        \"custom_name\": \"${custom_name}\"
                    }
                }
            }"
        else
            track_payload="{
                \"type\": \"pg_track_table\",
                \"args\": {
                    \"source\": \"${tenant_name}\",
                    \"table\": {
                        \"name\": \"${table_name}\",
                        \"schema\": \"${table_schema}\"
                    }
                }
            }"
        fi

        local track_response
        track_response=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
            -H "X-Hasura-Admin-Secret: ${admin_secret}" \
            -H "Content-Type: application/json" \
            -d "$track_payload")

        echo "🔎 Tracking table $table_name..."
        if [[ "$track_response" == *'"message":"success"'* ]] || \
           [[ "$track_response" == *'already tracked'* ]] || \
           [[ -z "$track_response" ]]; then
            echo "✅ Successfully tracked table $table_name"
        elif [[ "$track_response" == *'"error"'* ]]; then
            echo "ℹ️  Warning: Issue tracking table $table_name: $track_response"
        else
            echo "✅ Successfully tracked table $table_name"
        fi
    done

    echo "✅ Metadata deployment for $tenant_name tenant completed"
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# process_metadata_functions
# Tracks all functions for a tenant via Hasura API using yq for YAML parsing
# ─────────────────────────────────────────────────────────────────────────────
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

    for func_file in "$functions_dir"/*.yaml; do
        [ -f "$func_file" ] || continue

        # Skip index files
        if [[ "$(basename "$func_file")" == "functions.yaml" ]]; then
            continue
        fi

        # Parse using yq — reliable YAML parsing
        local func_name func_schema exposed_as
        func_name=$(yq e '.function.name' "$func_file" 2>/dev/null | tr -d '\r')
        func_schema=$(yq e '.function.schema' "$func_file" 2>/dev/null | tr -d '\r')
        exposed_as=$(yq e '.configuration.exposed_as' "$func_file" 2>/dev/null | tr -d '\r')

        # Apply defaults for null/empty values
        if [ -z "$func_schema" ] || [ "$func_schema" = "null" ]; then
            func_schema="public"
        fi
        if [ -z "$exposed_as" ] || [ "$exposed_as" = "null" ]; then
            exposed_as="query"
        fi

        if [ -z "$func_name" ] || [ "$func_name" = "null" ]; then
            echo "ℹ️  Warning: Could not determine function name from $func_file, skipping"
            continue
        fi

        echo "⚙️  Adding function: $func_name (schema: $func_schema) to tenant $tenant_name"
        echo "🔎 Tracking function $func_name..."

        local track_response
        track_response=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
            -H "X-Hasura-Admin-Secret: ${admin_secret}" \
            -H "Content-Type: application/json" \
            -d "{
                \"type\": \"pg_track_function\",
                \"args\": {
                    \"source\": \"${tenant_name}\",
                    \"function\": {
                        \"schema\": \"${func_schema}\",
                        \"name\": \"${func_name}\"
                    },
                    \"configuration\": {
                        \"exposed_as\": \"${exposed_as}\"
                    }
                }
            }")

        if [[ "$track_response" == *'"message":"success"'* ]] || \
           [[ "$track_response" == *'already tracked'* ]] || \
           [[ -z "$track_response" ]]; then
            echo "✅ Successfully tracked function $func_name"
        elif [[ "$track_response" == *'"error"'* ]]; then
            echo "❌ Error: Issue tracking function $func_name: $track_response"
        else
            echo "✅ Successfully tracked function $func_name"
        fi
    done

    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# deploy_tenant
# Orchestrates source registration, table tracking, and function tracking
# ─────────────────────────────────────────────────────────────────────────────
deploy_tenant() {
    local tenant="$1"
    local hasura_endpoint="$2"
    local admin_secret="$3"

    local temp_dir
    temp_dir=$(mktemp -d)
    TEMP_DIR="$temp_dir"

    local tenant_name
    tenant_name=$(create_metadata_source "$tenant" "$temp_dir" "$hasura_endpoint" "$admin_secret")

    if [ $? -ne 0 ]; then
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

    rm -rf "$temp_dir"
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────
main() {
    local tenants=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --admin-secret)
                HASURA_ADMIN_SECRET="$2"
                shift 2
                ;;
            --endpoint)
                HASURA_ENDPOINT="$2"
                shift 2
                ;;
            -*)
                echo "Unknown option: $1"
                exit 1
                ;;
            *)
                tenants+=("$1")
                shift
                ;;
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

    echo ""
    echo "====== DEPLOYMENT SUMMARY ======"
    echo "Total tenants processed: ${#tenants[@]}"
    echo "Successful deployments: ${#successful_tenants[@]}"
    echo "Failed deployments: ${#failed_tenants[@]}"

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