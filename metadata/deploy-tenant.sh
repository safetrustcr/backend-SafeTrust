#!/usr/bin/env bash
set -eo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
HASURA_ENDPOINT="http://localhost:8080"
HASURA_ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-}"

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

    # Copy table definitions
    if [ -d "$BUILD_DIR/$tenant/databases/tables" ]; then
        echo "Copying table definitions for $tenant..." >&2
        cp -r "$BUILD_DIR/$tenant/databases/tables"/* \
            "$temp_dir/metadata/databases/default/tables/"
    else
        echo "⚠️  Warning: No tables directory found at $BUILD_DIR/$tenant/databases/tables/" >&2
    fi

    # Copy function definitions
    if [ -d "$BUILD_DIR/$tenant/databases/functions" ]; then
        echo "Copying function definitions for $tenant..." >&2
        cp -r "$BUILD_DIR/$tenant/databases/functions"/* \
            "$temp_dir/metadata/databases/default/functions/"
    fi

    # Determine tenant name
    local tenant_name
    if [ -f "$BUILD_DIR/$tenant/databases/databases.yaml" ]; then
        tenant_name=$(grep -m 1 "name:" "$BUILD_DIR/$tenant/databases/databases.yaml" \
            | sed 's/.*name:\s*\([^ ]*\).*/\1/')
        echo "Found tenant name in databases.yaml: $tenant_name" >&2
    else
        tenant_name="$tenant"
        echo "No databases.yaml found, using tenant name: $tenant_name" >&2
    fi

    # Register source in Hasura
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

    # Only tenant_name goes to stdout — captured by $() in deploy_tenant
    echo "$tenant_name"
}

# ─────────────────────────────────────────────────────────────────────────────
# process_metadata_tables
# Tracks all tables for a tenant via Hasura API
# Returns non-zero if any table fails to track
# ─────────────────────────────────────────────────────────────────────────────
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

<<<<<<< HEAD
    local track_failures=0
=======
    local failure_count=0
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5

    for table_file in "$tables_dir"/*.yaml; do
        [ -f "$table_file" ] || continue

        local base_name
        base_name=$(basename "$table_file" .yaml)

        # Skip index files
        if [[ "$base_name" == "tables" ]]; then
            echo "ℹ️  Warning: Could not determine table name from $table_file, skipping"
            continue
        fi

        # Parse table name, schema and configuration using yq
        local table_name table_schema configuration_json
        table_name=$(yq e '.table.name' "$table_file" 2>/dev/null | tr -d '\r')
        table_schema=$(yq e '.table.schema' "$table_file" 2>/dev/null | tr -d '\r')
        configuration_json=$(yq e '.configuration' "$table_file" -o json 2>/dev/null | tr -d '\r')

        if [ -z "$table_schema" ] || [ "$table_schema" = "null" ]; then
            table_schema="public"
        fi

        if [ -z "$table_name" ] || [ "$table_name" = "null" ]; then
            echo "ℹ️  Warning: Could not determine table name from $table_file, skipping"
            continue
        fi

        echo "⚙️  Adding table: $table_name (schema: $table_schema) to tenant $tenant_name"

        # Build track payload — include full configuration object if present
        local track_payload
        if [ -n "$configuration_json" ] && [ "$configuration_json" != "null" ] && [ "$configuration_json" != "{}" ]; then
            track_payload=$(jq -n \
                --arg source "$tenant_name" \
                --arg name "$table_name" \
                --arg schema "$table_schema" \
                --argjson config "$configuration_json" \
                '{
                    "type": "pg_track_table",
                    "args": {
                        "source": $source,
                        "table": {
                            "name": $name,
                            "schema": $schema
                        },
                        "configuration": $config
                    }
                }')
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

            # Process object relationships if present
            local relationships_json
            relationships_json=$(yq e '.object_relationships' "$table_file" -o json 2>/dev/null)
            if [ -n "$relationships_json" ] && [ "$relationships_json" != "null" ] && [ "$relationships_json" != "[]" ]; then
                local rel_count
                rel_count=$(echo "$relationships_json" | jq 'length')
                echo "⚙️  Processing $rel_count object relationship(s) for $table_name..."

                for i in $(seq 0 $((rel_count - 1))); do
                    local rel_name rel_using
                    rel_name=$(echo "$relationships_json" | jq -r ".[$i].name")
                    rel_using=$(echo "$relationships_json" | jq -c ".[$i].using")

                    echo "⚙️  Adding relationship: $rel_name"

                    local rel_payload
                    rel_payload=$(jq -n \
                        --arg source "$tenant_name" \
                        --arg table_name "$table_name" \
                        --arg table_schema "$table_schema" \
                        --arg rel_name "$rel_name" \
                        --argjson rel_using "$rel_using" \
                        '{
                            "type": "pg_create_object_relationship",
                            "args": {
                                "source": $source,
                                "table": {
                                    "name": $table_name,
                                    "schema": $table_schema
                                },
                                "name": $rel_name,
                                "using": $rel_using
                            }
                        }')

                    local rel_response
                    rel_response=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
                        -H "X-Hasura-Admin-Secret: ${admin_secret}" \
                        -H "Content-Type: application/json" \
                        -d "$rel_payload")

                    if [[ "$rel_response" == *'"message":"success"'* ]] || \
                       [[ "$rel_response" == *'already exists'* ]]; then
                        echo "✅ Relationship $rel_name created"
                    elif [[ "$rel_response" == *'"error"'* ]]; then
                        echo "⚠️  Warning: Issue creating relationship $rel_name: $rel_response"
                    fi
                done
            fi
        elif [[ "$track_response" == *'"error"'* ]]; then
<<<<<<< HEAD
            echo "❌ Error tracking table $table_name: $track_response"
            track_failures=$(( track_failures + 1 ))
=======
            echo "ℹ️  Warning: Issue tracking table $table_name: $track_response"
            ((failure_count++))
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5
        else
            echo "✅ Successfully tracked table $table_name"
        fi
    done

<<<<<<< HEAD
    if [ "$track_failures" -gt 0 ]; then
        echo "❌ ${track_failures} table(s) failed to track for $tenant_name"
=======
    if [ $failure_count -gt 0 ]; then
        echo "⚠️  Metadata deployment for $tenant_name completed with $failure_count failure(s)"
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5
        return 1
    fi

    echo "✅ Metadata deployment for $tenant_name tenant completed"
    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# process_metadata_functions
# Tracks all functions for a tenant via Hasura API using yq for YAML parsing
# Returns non-zero if any function fails to track
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

<<<<<<< HEAD
    local track_failures=0
=======
    local failure_count=0
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5

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
<<<<<<< HEAD
            track_failures=$(( track_failures + 1 ))
=======
            ((failure_count++))
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5
        else
            echo "✅ Successfully tracked function $func_name"
        fi
    done

<<<<<<< HEAD
    if [ "$track_failures" -gt 0 ]; then
        echo "❌ ${track_failures} function(s) failed to track for $tenant_name"
=======
    if [ $failure_count -gt 0 ]; then
        echo "⚠️  Function tracking for $tenant_name completed with $failure_count failure(s)"
>>>>>>> 9cadd98b2b63f9371035fde5f572afb9b83523c5
        return 1
    fi

    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# deploy_tenant
# Orchestrates source registration, table tracking, function tracking
# and reports per-tenant deploy time
# ─────────────────────────────────────────────────────────────────────────────
deploy_tenant() {
    local tenant="$1"
    local hasura_endpoint="$2"
    local admin_secret="$3"
    local tenant_start=$SECONDS

    local temp_dir
    temp_dir=$(mktemp -d)
    TEMP_DIR="$temp_dir"

    # Use if ! pattern — set -e makes $? check unreachable after command substitution
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

    # Validate admin secret is set
    if [ -z "$HASURA_ADMIN_SECRET" ]; then
        echo "❌ Error: Hasura admin secret not set. Provide via --admin-secret or HASURA_GRAPHQL_ADMIN_SECRET env var"
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