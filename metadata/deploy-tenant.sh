#!/bin/bash
set -e

# Configuration
BUILD_DIR="$(pwd)/build"
HASURA_ENDPOINT="http://localhost:8082"
HASURA_ADMIN_SECRET="myadminsecretkey"

create_source() {
  local TENANT="$1"
  local TEMP_DIR="$2"
  local TENANT_NAME

  if [ -f "$BUILD_DIR/$TENANT/databases/databases.yaml" ]; then
    echo "Using existing databases.yaml as a base for $TENANT"
    TENANT_NAME=$(grep -m 1 "name:" "$BUILD_DIR/$TENANT/databases/databases.yaml" | sed 's/.*name:\s*\([^ ]*\).*/\1/')
    echo "Found tenant name in databases.yaml: $TENANT_NAME"
  else
    TENANT_NAME="$TENANT"
    echo "No databases.yaml found, using tenant name: $TENANT_NAME"
  fi

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

  echo "Checking if source ${TENANT_NAME} already exists..."
  CHECK_SOURCE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
    -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"pg_get_source_tables\", \"args\": {\"source\": \"${TENANT_NAME}\"}}")

  if [[ "$CHECK_SOURCE" == *"error"* ]]; then
    echo "Source $TENANT_NAME doesn't exist, creating it..."
    SOURCE_RESPONSE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
      -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
      -H "Content-Type: application/json" \
      -d @"$TEMP_DIR/create_source.json")

    echo "Source creation response: $SOURCE_RESPONSE"

    if [[ "$SOURCE_RESPONSE" == *"error"* ]]; then
      echo "❌ Failed to create source for $TENANT_NAME"
      echo "Error: $SOURCE_RESPONSE"
      return 1
    fi
  else
    echo "Source $TENANT_NAME already exists, skipping creation"
  fi

  echo "$TENANT_NAME"
}

attempt_migration_and_track_table() {
  local TENANT_NAME="$1"
  local SCHEMA_NAME="$2"
  local PURE_TABLE_NAME="$3"
  local TEMP_DIR="$4"

  MIGRATIONS_PATH="../migrations/$TENANT_NAME"

  if [ -d "$MIGRATIONS_PATH" ]; then
    echo "Running migrations for $TENANT_NAME..."

    hasura migrate apply \
      --admin-secret "$HASURA_ADMIN_SECRET" \
      --endpoint "$HASURA_ENDPOINT" \
      --database-name "$TENANT_NAME" \
      --project "$MIGRATIONS_PATH"

    # Check again if table exists
    TABLE_CHECK=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/query" \
      -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
      -H "Content-Type: application/json" \
      -d "{\"type\":\"run_sql\", \"args\": {\"source\":\"${TENANT_NAME}\", \"sql\":\"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${SCHEMA_NAME}' AND table_name = '${PURE_TABLE_NAME}')\"}}")

    TABLE_EXISTS=$(echo "$TABLE_CHECK" | grep -o 'true\|false' | head -1)

    if [[ "$TABLE_EXISTS" == "true" ]]; then
      echo "Table $PURE_TABLE_NAME was created by migrations, now tracking it..."

      cat > "$TEMP_DIR/track_table.json" << EOL
{
  "type": "pg_track_table",
  "args": {
    "source": "${TENANT_NAME}",
    "table": {
      "name": "${PURE_TABLE_NAME}",
      "schema": "${SCHEMA_NAME}"
    }
  }
}
EOL

      TRACK_RESPONSE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
        -H "Content-Type: application/json" \
        -d @"$TEMP_DIR/track_table.json")

      if [[ "$TRACK_RESPONSE" == *"error"* && "$TRACK_RESPONSE" != *"already tracked"* ]]; then
        echo "Warning: Issue tracking table $PURE_TABLE_NAME: $TRACK_RESPONSE"
      else
        echo "Successfully tracked table $PURE_TABLE_NAME"
      fi
    else
      echo "Warning: Table $PURE_TABLE_NAME still doesn't exist after migrations. Skipping."
    fi
  else
    echo "No migrations directory found for tenant $TENANT_NAME. Skipping table $PURE_TABLE_NAME."
  fi
}

track_all_tables() {
  local TENANT="$1"
  local TENANT_NAME="$2"
  local TEMP_DIR="$3"

  echo "Processing tables for $TENANT..."
  for TABLE_FILE in "$TEMP_DIR/metadata/databases/default/tables"/*.yaml; do
    if [ -f "$TABLE_FILE" ]; then
      FULL_TABLE_NAME=$(basename "$TABLE_FILE" .yaml)
      SCHEMA_NAME=$(echo "$FULL_TABLE_NAME" | cut -d'_' -f1)
      PURE_TABLE_NAME=$(echo "$FULL_TABLE_NAME" | cut -d'_' -f2-)

      if [ -z "$PURE_TABLE_NAME" ]; then
        echo "Warning: Could not determine table name from $TABLE_FILE, skipping"
        continue
      fi

      echo " ⚙️ Checking if table $PURE_TABLE_NAME exists in schema $SCHEMA_NAME for tenant $TENANT_NAME..."

      TABLE_CHECK=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/query" \
        -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"run_sql\", \"args\": {\"source\":\"${TENANT_NAME}\", \"sql\":\"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${SCHEMA_NAME}' AND table_name = '${PURE_TABLE_NAME}')\"}}")

      TABLE_EXISTS=$(echo "$TABLE_CHECK" | grep -o 'true\|false' | head -1)

      if [[ "$TABLE_EXISTS" == "true" ]]; then
        echo "Table $PURE_TABLE_NAME exists in database, tracking it..."
        cat > "$TEMP_DIR/track_table.json" << EOL
{
  "type": "pg_track_table",
  "args": {
    "source": "${TENANT_NAME}",
    "table": {
      "name": "${PURE_TABLE_NAME}",
      "schema": "${SCHEMA_NAME}"
    }
  }
}
EOL

        TRACK_RESPONSE=$(curl -s -X POST "${HASURA_ENDPOINT}/v1/metadata" \
          -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
          -H "Content-Type: application/json" \
          -d @"$TEMP_DIR/track_table.json")

        if [[ "$TRACK_RESPONSE" == *"error"* && "$TRACK_RESPONSE" != *"already tracked"* ]]; then
          echo "Warning: Issue tracking table $PURE_TABLE_NAME: $TRACK_RESPONSE"
        elif [[ "$TRACK_RESPONSE" == *"already tracked"* ]]; then
          echo "Table $PURE_TABLE_NAME is already tracked"
        else
          echo "Successfully tracked table $PURE_TABLE_NAME"
        fi
      else
        attempt_migration_and_track_table "$TENANT_NAME" "$SCHEMA_NAME" "$PURE_TABLE_NAME" "$TEMP_DIR"
      fi
    fi
  done
}

deploy_single_tenant() {
  local TENANT="$1"
  local TEMP_DIR
  TEMP_DIR=$(mktemp -d)

  TENANT_NAME=$(create_source "$TENANT" "$TEMP_DIR") || {
    echo "Failed to create source for $TENANT"
    rm -rf "$TEMP_DIR"
    return 1
  }

  track_all_tables "$TENANT" "$TENANT_NAME" "$TEMP_DIR"

  echo "✅ Metadata deployment for $TENANT tenant completed"
  rm -rf "$TEMP_DIR"
  return 0
}

# Main script logic
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

if [ ${#TENANTS[@]} -eq 0 ]; then
  echo "Error: No tenants specified. Usage: ./deploy-tenant.sh tenant1 tenant2 ... [--admin-secret SECRET] [--endpoint URL]"
  exit 1
fi

echo "Deploying metadata for tenants: ${TENANTS[*]}"

SUCCESSFUL_TENANTS=()
FAILED_TENANTS=()

for tenant in "${TENANTS[@]}"; do
  if deploy_single_tenant "$tenant"; then
    SUCCESSFUL_TENANTS+=("$tenant")
  else
    FAILED_TENANTS+=("$tenant")
  fi
done

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
