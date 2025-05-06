#!/usr/bin/env bash
set -eo pipefail  # Exit on errors and pipe failures

# Configuration
BUILD_DIR="$(pwd)/build"
HASURA_ENDPOINT="http://localhost:8082"  
HASURA_ADMIN_SECRET="myadminsecretkey"  

# Clean up temp directories on exit
cleanup() {
    if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# Function to create Hasura metadata source for a tenant
create_metadata_source() {
    local tenant="$1"
    local temp_dir="$2"
    local hasura_endpoint="$3"
    local admin_secret="$4"
    
    echo "==========================================="
    echo "Deploying metadata for tenant: $tenant"
    echo "==========================================="
    
    if [ ! -d "$BUILD_DIR/$tenant" ]; then
        echo "Error: No metadata found for tenant '$tenant'. Run build-metadata.sh first."
        return 1
    fi
    
    mkdir -p "$temp_dir/metadata/databases/default/tables"
    
    echo "Creating Hasura project structure for $tenant..."
    cat > "$temp_dir/config.yaml" << EOL
version: 3
endpoint: ${hasura_endpoint}
admin_secret: ${admin_secret}
metadata_directory: metadata
EOL

    if [ -d "$BUILD_DIR/$tenant/databases/tables" ]; then
        echo "Copying table definitions for $tenant..."
        cp -r "$BUILD_DIR/$tenant/databases/tables"/* "$temp_dir/metadata/databases/default/tables/"
    else
        echo "Warning: No tables directory found at $BUILD_DIR/$tenant/databases/tables/"
        return 1
    fi
    
    # Determine tenant name from databases.yaml or use tenant id
    local tenant_name
    if [ -f "$BUILD_DIR/$tenant/databases/databases.yaml" ]; then
        tenant_name=$(grep -m 1 "name:" "$BUILD_DIR/$tenant/databases/databases.yaml" | sed 's/.*name:\s*\([^ ]*\).*/\1/')
        echo "Found tenant name in databases.yaml: $tenant_name"
    else
        tenant_name="$tenant"
        echo "No databases.yaml found, using tenant name: $tenant_name"
    fi
    
    # Create source configuration
    echo "Creating database source for $tenant_name..."
    cat > "$temp_dir/create_source.json" << EOL
{
  "type": "pg_add_source",
  "args": {
    "name": "${tenant_name}",
    "configuration": {
      "connection_info": {
        "database_url": {
          "from_env": "PG_DATABASE_URL"
        },
        "isolation_level": "read-committed",
        "use_prepared_statements": false
      }
    }
  }
}
EOL

    # Check if source exists
    echo "Checking if source ${tenant_name} already exists..."
    local check_source
    check_source=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
      -H "X-Hasura-Admin-Secret: ${admin_secret}" \
      -H "Content-Type: application/json" \
      -d "{\"type\": \"pg_get_source_tables\", \"args\": {\"source\": \"${tenant_name}\"}}")
    
    # Create source if needed
    if [[ "$check_source" == *"error"* ]]; then
        echo "Source $tenant_name doesn't exist, creating it..."
        local source_response
        source_response=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
          -H "X-Hasura-Admin-Secret: ${admin_secret}" \
          -H "Content-Type: application/json" \
          -d @"$temp_dir/create_source.json")
        
        if [[ "$source_response" == *"error"* ]]; then
            echo "❌ Failed to create source for $tenant_name"
            echo "Error: $source_response"
            return 1
        fi
    else
        echo "Source $tenant_name already exists, skipping creation "
    fi
    
    echo " Tenant source created/verified: $tenant_name"
    # Return the tenant name for use in process_metadata_tables
    echo "$tenant_name"
}

# Function to process tables for a tenant
process_metadata_tables() {
    local tenant="$1"
    local tenant_name="$2"
    local temp_dir="$3"
    local hasura_endpoint="$4"
    local admin_secret="$5"
    
    echo "Processing tables for $tenant..."
    
    # Find all table definition files
    for table_file in "$temp_dir/metadata/databases/default/tables"/*.yaml; do
        if [ -f "$table_file" ]; then
            local table_name
            table_name=$(basename "$table_file" .yaml)
            
            if [ -z "$table_name" ]; then
                echo "Warning: Could not determine table name from $table_file, skipping"
                continue
            fi
            
            echo "Adding table: $table_name to tenant $tenant_name"
            
            # Create table tracking request
            cat > "$temp_dir/track_table.json" << EOL
{
  "type": "pg_track_table",
  "args": {
    "source": "${tenant_name}",
    "table": {
      "name": "${table_name}",
      "schema": "public"
    }
  }
}
EOL
            echo "Tracking table $table_name..."
            local track_response
            track_response=$(curl -s -X POST "${hasura_endpoint}/v1/metadata" \
                -H "X-Hasura-Admin-Secret: ${admin_secret}" \
                -H "Content-Type: application/json" \
                -d @"$temp_dir/track_table.json")
            
            if [[ "$track_response" == *"error"* && "$track_response" != *"already tracked"* ]]; then
                echo "Warning: Issue tracking table $table_name: $track_response"
            elif [[ "$track_response" == *"already tracked"* ]]; then
                echo "Table $table_name is already tracked"
            else
                echo "Successfully tracked table $table_name"
            fi
        fi
    done
    
    echo "✅ Metadata deployment for $tenant tenant completed"
    return 0
}

# Function to orchestrate the deployment process for a single tenant
deploy_tenant() {
    local tenant="$1"
    local hasura_endpoint="$2"
    local admin_secret="$3"
    
    # Create temporary directory
    local temp_dir
    temp_dir=$(mktemp -d)
    
    # Create metadata source and get tenant name
    local tenant_name
    tenant_name=$(create_metadata_source "$tenant" "$temp_dir" "$hasura_endpoint" "$admin_secret")
    
    # Check if source creation was successful
    if [ $? -ne 0 ]; then
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Process tables for the tenant
    if ! process_metadata_tables "$tenant" "$tenant_name" "$temp_dir" "$hasura_endpoint" "$admin_secret"; then
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Clean up
    rm -rf "$temp_dir"
    return 0
}

# Main script execution
main() {
    local tenants=()
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        key="$1"
        case $key in
            --admin-secret)
                HASURA_ADMIN_SECRET="$2"
                shift
                shift
                ;;
            --endpoint)
                HASURA_ENDPOINT="$2"
                shift
                shift
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
    
    # Validate input
    if [ ${#tenants[@]} -eq 0 ]; then
        echo "Error: No tenants specified. Usage: ./deploy-tenant.sh tenant1 tenant2 ... [--admin-secret SECRET] [--endpoint URL]"
        exit 1
    fi
    
    echo "Deploying metadata for tenants: ${tenants[*]}"
    
    # Process each tenant
    local successful_tenants=()
    local failed_tenants=()
    
    for tenant in "${tenants[@]}"; do
        if deploy_tenant "$tenant" "$HASURA_ENDPOINT" "$HASURA_ADMIN_SECRET"; then
            successful_tenants+=("$tenant")
        else
            failed_tenants+=("$tenant")
        fi
    done
    
    # Print summary
    echo ""
    echo "====== DEPLOYMENT SUMMARY ======"
    echo "Total tenants processed: ${#tenants[@]}"
    echo "Successful deployments: ${#successful_tenants[@]}"
    echo "Failed deployments: ${#failed_tenants[@]}"
    
    if [ ${#successful_tenants[@]} -gt 0 ]; then
        echo "Successfully deployed tenants: ${successful_tenants[*]}"
    fi
    
    if [ ${#failed_tenants[@]} -gt 0 ]; then
        echo "Failed to deploy tenants: ${failed_tenants[*]}"
        exit 1
    fi
    
    echo "All tenant deployments have been completed!"
}

# Execute main function
main "$@"