#!/bin/bash

# deploy-tenant.sh - Deploys metadata for multiple tenants to Hasura
# Usage: ./deploy-tenant.sh tenant1 tenant2 [--admin-secret SECRET] [--endpoint URL]

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
BUILD_DIR="$(pwd)/build"
HASURA_ENDPOINT="http://localhost:8082"  # Default endpoint
HASURA_ADMIN_SECRET="myadminsecretkey"  # Default admin secret

# Function to deploy a single tenant
deploy_single_tenant() {
    local TENANT="$1"
    echo "==========================================="
    echo "Deploying metadata for tenant: $TENANT"
    echo "==========================================="

    # Check if metadata for the tenant exists
    if [ ! -d "$BUILD_DIR/$TENANT" ]; then
        echo "Error: No metadata found for tenant '$TENANT'. Run build-metadata.sh first."
        return 1
    fi

    # Create a temporary directory
    TEMP_DIR=$(mktemp -d)
    mkdir -p "$TEMP_DIR/metadata/databases/default/tables"
    
    echo "Creating Hasura project structure for $TENANT..."
    # Initialize a Hasura project in the temporary directory
    cat > "$TEMP_DIR/config.yaml" << EOL
version: 3
endpoint: ${HASURA_ENDPOINT}
admin_secret: ${HASURA_ADMIN_SECRET}
metadata_directory: metadata
EOL

    # Copy all the table YAML files to the temporary directory
    if [ -d "$BUILD_DIR/$TENANT/databases/tables" ]; then
        echo "Copying table definitions for $TENANT..."
        cp -r "$BUILD_DIR/$TENANT/databases/tables"/* "$TEMP_DIR/metadata/databases/default/tables/"
    else
        echo "Warning: No tables directory found at $BUILD_DIR/$TENANT/databases/tables/"
        rm -rf "$TEMP_DIR"
        return 1
    fi

    # Read existing databases.yaml content
    if [ -f "$BUILD_DIR/$TENANT/databases/databases.yaml" ]; then
        echo "Using existing databases.yaml as a base for $TENANT"
        # Fixed the regex pattern to properly extract the tenant name
        TENANT_NAME=$(grep -m 1 "name:" "$BUILD_DIR/$TENANT/databases/databases.yaml" | sed 's/.*name:\s*\([^ ]*\).*/\1/')
        echo "Found tenant name in databases.yaml: $TENANT_NAME"
    else
        TENANT_NAME="$TENANT"
        echo "No databases.yaml found, using tenant name: $TENANT_NAME"
    fi

    # * STEP 1: CREATE THE DATABASE SOURCE *
    echo "Creating database source for $TENANT_NAME..."
    cat > "$TEMP_DIR/create_source.json" << EOL
{
  "type": "pg_add_source",
  "args": {
    "name": "${TENANT_NAME}",
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

    # First check if source already exists
    echo "Checking if source ${TENANT_NAME} already exists..."
    CHECK_SOURCE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
      -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
      -H "Content-Type: application/json" \
      -d "{\"type\": \"pg_get_source_tables\", \"args\": {\"source\": \"${TENANT_NAME}\"}}")
    
    # Fixed the condition to check for error in the response
    if [[ "$CHECK_SOURCE" == *"error"* ]]; then
        echo "Source $TENANT_NAME doesn't exist, creating it..."
        SOURCE_RESPONSE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
          -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
          -H "Content-Type: application/json" \
          -d @"$TEMP_DIR/create_source.json")
        
        echo "Source creation response: $SOURCE_RESPONSE"
        
        # Check if source was created successfully
        if [[ "$SOURCE_RESPONSE" == *"error"* ]]; then
            echo "❌ Failed to create source for $TENANT_NAME"
            echo "Error: $SOURCE_RESPONSE"
            return 1
        fi
    else
        echo "Source $TENANT_NAME already exists, skipping creation"
    fi

    # * STEP 2: TRACK THE TABLES *
    # Find and process all table YAML files
    echo "Processing tables for $TENANT..."
    for TABLE_FILE in "$TEMP_DIR/metadata/databases/default/tables"/*.yaml; do
        if [ -f "$TABLE_FILE" ]; then
            # Extract table name from the file name instead of the YAML content
            TABLE_NAME=$(basename "$TABLE_FILE" .yaml)
            
            # Skip empty files
            if [ -z "$TABLE_NAME" ]; then
                echo "Warning: Could not determine table name from $TABLE_FILE, skipping"
                continue
            fi
            
            echo "Adding table: $TABLE_NAME to tenant $TENANT_NAME"
            
            # Now track this table using metadata API
            cat > "$TEMP_DIR/track_table.json" << EOL
{
  "type": "pg_track_table",
  "args": {
    "source": "${TENANT_NAME}",
    "table": {
      "name": "${TABLE_NAME}",
      "schema": "public"
    }
  }
}
EOL

            echo "Tracking table $TABLE_NAME..."
            TRACK_RESPONSE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
                -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
                -H "Content-Type: application/json" \
                -d @"$TEMP_DIR/track_table.json")
            
            # Fixed the condition to check for error in the response
            if [[ "$TRACK_RESPONSE" == *"error"* && "$TRACK_RESPONSE" != *"already tracked"* ]]; then
                echo "Warning: Issue tracking table $TABLE_NAME: $TRACK_RESPONSE"
            elif [[ "$TRACK_RESPONSE" == *"already tracked"* ]]; then
                echo "Table $TABLE_NAME is already tracked"
            else
                echo "Successfully tracked table $TABLE_NAME"
            fi
        fi
    done

    echo "✅ Metadata deployment for $TENANT tenant completed"
    rm -rf "$TEMP_DIR"
    return 0
}

# Process command line arguments
TENANTS=()
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
            TENANTS+=("$1")
            shift
            ;;
    esac
done

# Check if any tenants were provided
if [ ${#TENANTS[@]} -eq 0 ]; then
    echo "Error: No tenants specified. Usage: ./deploy-tenant.sh tenant1 tenant2 ... [--admin-secret SECRET] [--endpoint URL]"
    exit 1
fi

echo "Deploying metadata for tenants: ${TENANTS[*]}"

# Track success/failure
SUCCESSFUL_TENANTS=()
FAILED_TENANTS=()

# Deploy each tenant
for tenant in "${TENANTS[@]}"; do
    if deploy_single_tenant "$tenant"; then
        SUCCESSFUL_TENANTS+=("$tenant")
    else
        FAILED_TENANTS+=("$tenant")
    fi
done

# Display summary
echo ""
echo "====== DEPLOYMENT SUMMARY ======"
echo "Total tenants processed: ${#TENANTS[@]}"
echo "Successful deployments: ${#SUCCESSFUL_TENANTS[@]}"
echo "Failed deployments: ${#FAILED_TENANTS[@]}"

if [ ${#SUCCESSFUL_TENANTS[@]} -gt 0 ]; then
    echo "Successfully deployed tenants: ${SUCCESSFUL_TENANTS[*]}"
fi

if [ ${#FAILED_TENANTS[@]} -gt 0 ]; then
    echo "Failed to deploy tenants: ${FAILED_TENANTS[*]}"
    exit 1
fi

echo "All tenant deployments have been completed!"