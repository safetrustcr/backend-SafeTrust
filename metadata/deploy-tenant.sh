#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# metadata/deploy-tenant.sh
#
# Deploys the *complete* metadata for one or more tenants:
#   • source registration
#   • table configuration
#   • select/insert/update/delete permissions
#   • object/array relationships
#   • event triggers
#   • tracked functions and their permissions
#   • shared metadata (actions, cron triggers, inherited roles, …)
#
# Metadata is applied with a single replace_metadata call containing the full
# assembled document: the metadata currently on the server plus the desired
# source for the tenant(s) being deployed. This is equivalent to running
# `hasura metadata apply` against a metadata directory that contains every
# source. Assembling the full document is required for multi-tenant safety —
# replacing with only one tenant's source would silently delete every other
# tenant's source and all shared metadata.
#
# Ordering matters: migrations are validated before dependent metadata is
# applied, otherwise permissions/relationships can reference tables that do
# not exist yet and Hasura will report inconsistent metadata.
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

BUILD_DIR="${BUILD_DIR:-$SCRIPT_DIR/build}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT_DIR/migrations}"
HASURA_ENDPOINT="${HASURA_GRAPHQL_ENDPOINT:-http://localhost:8080}"
HASURA_ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-myadminsecretkey}"
HASURA_CLI="${HASURA_CLI:-hasura}"
CLOUD_TARGET=false
SKIP_ROLE_CHECKS=false

ADMIN_SECRET_EXPLICIT=false
if [[ -n "${HASURA_GRAPHQL_ADMIN_SECRET:-}" ]]; then
    ADMIN_SECRET_EXPLICIT=true
fi

# jq helpers used to merge the desired metadata into the server's current
# metadata without deleting sources or shared objects owned by other tenants.
# Arrays of named objects are merged by name (desired entries replace/append;
# existing entries are never dropped). Scalar lists are unioned.
JQ_MERGE_SHARED='
def named($key):
  if type == "object" then (.[$key] // "") else "" end;

def merge_by_key($base; $overlay; $key):
  reduce (($overlay // [])[]) as $item ($base // [];
    if (($item | named($key)) | length) > 0 then
      if any(.[]; named($key) == ($item | named($key))) then
        map(if named($key) == ($item | named($key)) then $item else . end)
      else
        . + [$item]
      end
    else
      if any(.[]; . == $item) then . else . + [$item] end
    end);

def merge_named($base; $overlay):
  merge_by_key($base; $overlay; "name");

def merge_unique($base; $overlay):
  (($base // []) + ($overlay // [])) | unique;

def richer_type($base_item; $overlay_item):
  if (($overlay_item.fields // []) | length) > 0 then $overlay_item
  elif (($base_item.fields // []) | length) > 0 then $base_item
  else $overlay_item end;

def merge_typed($base; $overlay):
  reduce (($overlay // [])[]) as $item ($base // [];
    if (($item.name // "") | length) > 0 then
      if any(.[]; (.name // "") == $item.name) then
        map(if (.name // "") == $item.name then richer_type(.; $item) else . end)
      else
        . + [$item]
      end
    else
      .
    end);

def merge_types($base; $overlay):
  ($base // {}) as $b
  | ($overlay // {}) as $o
  | $b * {
      enums: merge_typed($b.enums; $o.enums),
      input_objects: merge_typed($b.input_objects; $o.input_objects),
      objects: merge_typed($b.objects; $o.objects),
      scalars: merge_unique($b.scalars; $o.scalars)
    };

def merge_shared($base; $overlay):
  ($base // {}) as $b
  | ($overlay // {}) as $o
  | $b
  | .version = ($o.version // .version // 3)
  | if (($o | has("actions")) and (($o.actions // []) | length) > 0)
      then .actions = merge_named(.actions; $o.actions) else . end
  | if (($o | has("custom_types")) and (($o.custom_types // {}) | length) > 0)
      then .custom_types = merge_types(.custom_types; $o.custom_types) else . end
  | if (($o | has("inherited_roles")) and (($o.inherited_roles // []) | length) > 0)
      then .inherited_roles = merge_by_key(.inherited_roles; $o.inherited_roles; "role") else . end
  | if (($o | has("cron_triggers")) and (($o.cron_triggers // []) | length) > 0)
      then .cron_triggers = merge_named(.cron_triggers; $o.cron_triggers) else . end
  | if (($o | has("remote_schemas")) and (($o.remote_schemas // []) | length) > 0)
      then .remote_schemas = merge_named(.remote_schemas; $o.remote_schemas) else . end
  | if (($o | has("query_collections")) and (($o.query_collections // []) | length) > 0)
      then .query_collections = merge_named(.query_collections; $o.query_collections) else . end
  | if (($o | has("rest_endpoints")) and (($o.rest_endpoints // []) | length) > 0)
      then .rest_endpoints = merge_named(.rest_endpoints; $o.rest_endpoints) else . end
  | if (($o | has("allow_list")) and (($o.allow_list // []) | length) > 0)
      then .allow_list = merge_unique(.allow_list; $o.allow_list) else . end
  | if (($o | has("graphql_schema_introspection")) and (($o.graphql_schema_introspection // {}) | length) > 0)
      then
        .graphql_schema_introspection = ((.graphql_schema_introspection // {}) * $o.graphql_schema_introspection)
        | .graphql_schema_introspection.disabled_for_roles =
            merge_unique(.graphql_schema_introspection.disabled_for_roles;
                         $o.graphql_schema_introspection.disabled_for_roles)
      else . end
  | reduce (["api_limits", "backend_configs", "metrics_config", "network", "opentelemetry"][]) as $key (.;
      if (($o | has($key)) and (($o[$key] // {}) | length) > 0)
        then .[$key] = ((.[$key] // {}) * $o[$key]) else . end);
'

log()  { printf '%s\n' "$*" >&2; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
fail() { printf '❌ %s\n' "$*" >&2; }

require_tools() {
    local missing=()
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v jq   >/dev/null 2>&1 || missing+=("jq")
    command -v yq   >/dev/null 2>&1 || missing+=("yq (mikefarah v4)")
    command -v "$HASURA_CLI" >/dev/null 2>&1 || missing+=("hasura CLI")

    if [[ ${#missing[@]} -gt 0 ]]; then
        fail "Missing required tools: ${missing[*]}"
        return 1
    fi
}

# Calls a Hasura metadata API command. $1 is either an inline JSON payload or a
# file path (large replace_metadata payloads are passed with --data-binary).
# Success prints the response body to stdout; failures print diagnostics to
# stderr and return non-zero. The admin secret is sent in a header and is never
# printed or written to a log.
metadata_api_request() {
    local payload="$1"
    local label="$2"
    local data_arg
    local response
    local http_code
    local body

    if [[ -f "$payload" ]]; then
        data_arg="@$payload"
    else
        data_arg="$payload"
    fi

    if ! response=$(curl -sS -w $'\n%{http_code}' \
        -X POST "${HASURA_ENDPOINT}/v1/metadata" \
        -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
        -H "Content-Type: application/json" \
        --data-binary "$data_arg" 2>&1); then
        fail "$label: could not reach ${HASURA_ENDPOINT}/v1/metadata"
        printf '%s\n' "$response" >&2
        return 1
    fi

    http_code="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if [[ "$http_code" != "200" ]] || printf '%s' "$body" | jq -e 'type == "object" and has("error")' >/dev/null 2>&1; then
        fail "$label failed (HTTP ${http_code})"
        printf '%s\n' "$body" >&2
        return 1
    fi

    printf '%s' "$body"
}

export_metadata() {
    local body
    if ! body=$(metadata_api_request '{"type":"export_metadata","args":{}}' "export_metadata"); then
        return 1
    fi
    if ! printf '%s' "$body" | jq -e '(.metadata // .) | type == "object"' >/dev/null 2>&1; then
        fail "export_metadata returned an unexpected response"
        printf '%s\n' "$body" >&2
        return 1
    fi
    printf '%s' "$body" | jq -c '(.metadata // .)'
}

# Resolves the Hasura source name from the built databases.yaml. Only the source
# name is written to stdout so it can be captured safely.
resolve_source_name() {
    local tenant="$1"
    local build_dir="$2"
    local databases_yaml="$build_dir/databases/databases.yaml"
    local source_name
    local databases_json

    if [[ ! -f "$databases_yaml" ]]; then
        fail "No databases.yaml found at $databases_yaml (run build-metadata.sh first)"
        return 1
    fi

    if ! databases_json=$(yq -o=json eval '.' "$databases_yaml" 2>/dev/null); then
        fail "Failed to parse $databases_yaml"
        return 1
    fi
    if ! source_name=$(printf '%s' "$databases_json" | jq -r '
        (if type == "array" then .[0].name else .name end) // empty
    '); then
        fail "Failed to read the source name from $databases_yaml"
        return 1
    fi

    if [[ -z "$source_name" || "$source_name" == "null" ]]; then
        source_name="$tenant"
        warn "No source name in databases.yaml, using tenant name: $source_name"
    fi

    if [[ ! "$source_name" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
        fail "Invalid Hasura source name '$source_name'"
        return 1
    fi

    printf '%s' "$source_name"
}

# Builds the desired source document from the per-table/function YAML. Every
# field in those files is preserved: configuration, permissions, relationships,
# event triggers, computed fields, comments, etc.
build_desired_source() {
    local build_dir="$1"
    local output_file="$2"
    local databases_yaml="$build_dir/databases/databases.yaml"
    local source_json
    local tables_json='[]'
    local functions_json='[]'
    local tables_dir="$build_dir/databases/tables"
    local functions_dir="$build_dir/databases/functions"

    if [[ ! -f "$databases_yaml" ]]; then
        fail "No databases.yaml found at $databases_yaml"
        return 1
    fi

    if ! source_json=$(yq -o=json eval '.' "$databases_yaml" 2>/dev/null); then
        fail "Failed to read source definition from $databases_yaml"
        return 1
    fi
    source_json=$(printf '%s' "$source_json" | jq -c 'if type == "array" then .[0] else . end') || {
        fail "Source definition in $databases_yaml is not a valid object"
        return 1
    }
    if ! printf '%s' "$source_json" | jq -e 'type == "object" and ((.name // "") | length) > 0' >/dev/null 2>&1; then
        fail "Source definition in $databases_yaml is missing a name"
        return 1
    fi

    # Includes are metadata-directory plumbing, not API fields.
    source_json=$(printf '%s' "$source_json" | jq -c 'del(.tables, .functions)')

    if [[ -d "$tables_dir" ]]; then
        local file
        while IFS= read -r -d '' file; do
            case "$(basename "$file")" in
                tables.yaml | tables.yml | functions.yaml | functions.yml) continue ;;
            esac

            local item
            if ! item=$(yq -o=json eval '.' "$file" 2>/dev/null); then
                fail "Failed to parse table metadata: $file"
                return 1
            fi
            if ! printf '%s' "$item" | jq -e '
                if type == "array" then all(.[]; ((.table.name? // "") | length) > 0)
                else ((.table.name? // "") | length) > 0 end
            ' >/dev/null 2>&1; then
                fail "Table metadata is missing a table name: $file"
                return 1
            fi

            # Some table files mix metadata fields with migration-schema fields
            # (columns/constraints/indexes/triggers). The metadata API only
            # accepts the table fields below, so strip everything else.
            if ! item=$(printf '%s' "$item" | jq -c '
                def normalize_table($t):
                  {
                    table: $t.table,
                    configuration: $t.configuration,
                    is_enum: $t.is_enum,
                    object_relationships: $t.object_relationships,
                    array_relationships: $t.array_relationships,
                    computed_fields: $t.computed_fields,
                    remote_relationships: $t.remote_relationships,
                    insert_permissions: $t.insert_permissions,
                    select_permissions: $t.select_permissions,
                    update_permissions: $t.update_permissions,
                    delete_permissions: $t.delete_permissions,
                    event_triggers: $t.event_triggers,
                    comment: $t.comment
                  }
                  | with_entries(select(.value != null));
                if type == "array" then map(normalize_table(.)) else normalize_table(.) end
            '); then
                fail "Failed to normalize table metadata: $file"
                return 1
            fi
            tables_json=$(printf '%s' "$tables_json" | jq -c --argjson item "$item" \
                '. + (if ($item | type) == "array" then $item else [$item] end)') || return 1
        done < <(find "$tables_dir" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) -print0)
    fi

    if [[ -d "$functions_dir" ]]; then
        local file
        while IFS= read -r -d '' file; do
            case "$(basename "$file")" in
                tables.yaml | tables.yml | functions.yaml | functions.yml) continue ;;
            esac

            local item
            if ! item=$(yq -o=json eval '.' "$file" 2>/dev/null); then
                fail "Failed to parse function metadata: $file"
                return 1
            fi
            if ! printf '%s' "$item" | jq -e '
                if type == "array" then all(.[]; ((.function.name? // .name? // "") | length) > 0)
                else ((.function.name? // .name? // "") | length) > 0 end
            ' >/dev/null 2>&1; then
                fail "Function metadata is missing a function name: $file"
                return 1
            fi

            # Function files in this repo mix metadata fields with migration
            # fields (definition/dependencies/description/privilege). The metadata
            # API only accepts function/configuration/permissions/comment, so
            # normalize to the export_metadata shape before applying.
            if ! item=$(printf '%s' "$item" | jq -c '
                def normalize_function($f):
                  ($f.function // {schema: ($f.schema // "public"), name: ($f.name // "")}) as $fn
                  | ($f.configuration // {}) as $cfg
                  | {
                      function: $fn,
                      configuration: ($cfg + {exposed_as: ($cfg.exposed_as // $f.exposed_as // "query")}),
                      permissions: [
                        ($f.permissions // [])[]?
                        | {role: .role}
                        + (if (.comment? // null) != null then {comment} else {} end)
                      ],
                      comment: $f.comment
                    }
                  | with_entries(select(.value != null));
                if type == "array" then map(normalize_function(.)) else normalize_function(.) end
            '); then
                fail "Failed to normalize function metadata: $file"
                return 1
            fi
            if ! printf '%s' "$item" | jq -e '
                if type == "array" then all(.[]; ((.function.name // "") | length) > 0)
                else ((.function.name // "") | length) > 0 end
            ' >/dev/null 2>&1; then
                fail "Normalized function metadata is missing a function name: $file"
                return 1
            fi
            functions_json=$(printf '%s' "$functions_json" | jq -c --argjson item "$item" \
                '. + (if ($item | type) == "array" then $item else [$item] end)') || return 1
        done < <(find "$functions_dir" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) -print0)
    fi

    if ! printf '%s' "$source_json" | jq -c --argjson tables "$tables_json" \
        --argjson functions "$functions_json" '. + {tables: $tables, functions: $functions}' \
        > "$output_file"; then
        fail "Failed to assemble desired source metadata"
        return 1
    fi
}

# Converts actions.graphql SDL into the custom_types shape accepted by the
# metadata API. The metadata CLI reads actions.graphql itself, but the API's
# replace_metadata requires explicit input_objects/objects with their fields.
# Only simple SDL used by this repository is supported: single-line fields,
# input/type blocks, and scalar declarations.
parse_actions_graphql() {
    local graphql_file="$1"
    local output_file="$2"

    if [[ ! -f "$graphql_file" ]]; then
        printf '%s' '{"enums":[],"input_objects":[],"objects":[],"scalars":[]}' > "$output_file"
        return 0
    fi

    if ! awk '
        function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
        BEGIN { kind = ""; name = ""; inblock = 0 }
        {
            line = $0
            sub(/\r$/, "", line)

            if (inblock) {
                if (line ~ /^[ \t]*}/) { inblock = 0; kind = ""; name = ""; next }
                if (kind == "") { next }
                sub(/^[ \t]+/, "", line)
                sub(/[ \t]*#.*/, "", line)
                if (line == "") { next }
                pos = index(line, ":")
                if (pos == 0) { next }
                fname = trim(substr(line, 1, pos - 1))
                ftype = trim(substr(line, pos + 1))
                if (fname == "" || ftype == "") { next }
                print kind "\t" name "\t" fname "\t" ftype
                next
            }

            t = line
            sub(/^[ \t]+/, "", t)
            if (match(t, /^(input|type|enum)[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\{/)) {
                split(t, a, /[ \t]+/)
                k = a[1]
                n = a[2]
                sub(/[ \t]*\{.*/, "", n)
                if (k == "type" && (n == "Mutation" || n == "Query" || n == "Subscription")) {
                    inblock = 1; kind = ""; name = ""
                } else {
                    inblock = 1; kind = k; name = n
                }
                next
            }
            if (match(t, /^scalar[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
                split(t, a, /[ \t]+/)
                print "scalar\t" a[2]
                next
            }
        }
    ' "$graphql_file" | jq -Rn '
        [inputs | select(length > 0) | split("\t")] as $rows
        | def fields_for($kind):
            [ $rows[] | select(.[0] == $kind) ]
            | group_by(.[1])
            | map({name: .[0][1], fields: map({name: .[2], type: .[3]})});
        {
          enums: [],
          input_objects: fields_for("input"),
          objects: fields_for("type"),
          scalars: ([ $rows[] | select(.[0] == "scalar") | .[1] ] | unique)
        }
    ' > "$output_file"; then
        fail "Failed to parse action SDL: $graphql_file"
        return 1
    fi
}

# Builds shared metadata (actions, cron triggers, inherited roles, …) from the
# build directory. Shared entries are merged into the server's existing shared
# metadata without deleting entries that belong to another tenant.
build_shared_overlay() {
    local build_dir="$1"
    local output_file="$2"
    local overlay='{}'
    local file
    local base
    local key
    local parsed
    local sdl_file

    if [[ ! -d "$build_dir" ]]; then
        fail "Metadata build directory not found: $build_dir"
        return 1
    fi

    for file in "$build_dir"/*.yaml "$build_dir"/*.yml; do
        [[ -e "$file" ]] || continue
        base="$(basename "$file")"

        case "$base" in
            version.yaml | databases.yaml | tables.yaml | functions.yaml)
                continue
                ;;
        esac

        if ! parsed=$(yq -o=json eval '.' "$file" 2>/dev/null); then
            fail "Failed to parse shared metadata: $file"
            return 1
        fi

        case "$base" in
            actions.yaml | actions.yml)
                overlay=$(printf '%s' "$overlay" | jq -c --argjson parsed "$parsed" '
                    .actions = ((.actions // []) + ($parsed.actions // []))
                    | .custom_types = {
                        enums: (((.custom_types // {}).enums // []) + (($parsed.custom_types // {}).enums // [])),
                        input_objects: (((.custom_types // {}).input_objects // []) + (($parsed.custom_types // {}).input_objects // [])),
                        objects: (((.custom_types // {}).objects // []) + (($parsed.custom_types // {}).objects // [])),
                        scalars: (((.custom_types // {}).scalars // []) + (($parsed.custom_types // {}).scalars // []))
                      }
                ') || return 1
                ;;
            allow_list.yaml | inherited_roles.yaml | cron_triggers.yaml | \
                query_collections.yaml | remote_schemas.yaml | rest_endpoints.yaml)
                key="${base%.yaml}"
                overlay=$(printf '%s' "$overlay" | jq -c --arg key "$key" --argjson parsed "$parsed" \
                    '.[$key] = ((.[$key] // []) + $parsed)') || return 1
                ;;
            graphql_schema_introspection.yaml)
                overlay=$(printf '%s' "$overlay" | jq -c --argjson parsed "$parsed" \
                    '.graphql_schema_introspection = $parsed') || return 1
                ;;
            *)
                # Scalar/object shared configuration (api_limits, network, …).
                overlay=$(printf '%s' "$overlay" | jq -c --argjson parsed "$parsed" \
                    'if ($parsed | type) == "object" then . * $parsed else . end') || return 1
                ;;
        esac
    done

    # Expand `actions.graphql` into custom_types fields. Without this, base
    # actions that rely on actions.graphql types would reference undefined
    # input/output types when applied through the metadata API.
    sdl_file="$(mktemp)"
    if ! parse_actions_graphql "$build_dir/actions.graphql" "$sdl_file"; then
        rm -f "$sdl_file"
        return 1
    fi
    if ! overlay=$(printf '%s' "$overlay" | jq -c --slurpfile sdl "$sdl_file" '
        def richer_type($base_item; $overlay_item):
          if (($overlay_item.fields // []) | length) > 0 then $overlay_item
          elif (($base_item.fields // []) | length) > 0 then $base_item
          else $overlay_item end;
        def merge_typed($base; $overlay):
          reduce (($overlay // [])[]) as $item ($base // [];
            if (($item.name // "") | length) > 0 then
              if any(.[]; (.name // "") == $item.name) then
                map(if (.name // "") == $item.name then richer_type(.; $item) else . end)
              else
                . + [$item]
              end
            else . end);
        (.custom_types // {enums: [], input_objects: [], objects: [], scalars: []}) as $ct
        | .custom_types = {
            enums: ($ct.enums // []),
            input_objects: merge_typed($ct.input_objects; $sdl[0].input_objects),
            objects: merge_typed($ct.objects; $sdl[0].objects),
            scalars: ((($ct.scalars // []) + ($sdl[0].scalars // [])) | unique)
          }
    '); then
        rm -f "$sdl_file"
        fail "Failed to merge action SDL custom types"
        return 1
    fi
    rm -f "$sdl_file"

    printf '%s' "$overlay" > "$output_file"
}

assemble_full_metadata() {
    local source_name="$1"
    local exported_file="$2"
    local source_file="$3"
    local overlay_file="$4"
    local output_file="$5"

    if ! jq -c --arg source_name "$source_name" \
        --slurpfile source "$source_file" \
        --slurpfile overlay "$overlay_file" \
        "${JQ_MERGE_SHARED}"'
        .version = (.version // 3)
        | .sources = (((.sources // []) | map(select((.name // "") != $source_name))) + [$source[0]])
        | merge_shared(.; $overlay[0])
        ' "$exported_file" > "$output_file"; then
        fail "Failed to assemble the full metadata document"
        return 1
    fi

    if ! jq -e '
        (((.sources // []) | map(.name) | length) ==
         ((.sources // []) | map(.name) | unique | length))
    ' "$output_file" >/dev/null 2>&1; then
        fail "Assembled metadata contains duplicate source names"
        return 1
    fi
}

ensure_source_registered() {
    local source_name="$1"
    local source_file="$2"
    local exported_file="$3"
    local payload
    local response

    if jq -e --arg name "$source_name" '((.sources // []) | any(.name == $name))' \
        "$exported_file" >/dev/null 2>&1; then
        log "Source already registered: $source_name"
        return 0
    fi

    log "Registering source: $source_name"
    if ! payload=$(jq -c '
        {name, kind: (.kind // "postgres"), configuration}
        + (if (.customization? // null) != null then {customization} else {} end)
    ' "$source_file"); then
        fail "Failed to build pg_add_source payload for $source_name"
        return 1
    fi

    if ! response=$(metadata_api_request \
        "$(jq -cn --argjson source "$payload" '{type:"pg_add_source", args:$source}')" \
        "pg_add_source(${source_name})" 2>&1); then
        if printf '%s' "$response" | grep -qi 'already exists'; then
            log "Source $source_name was registered concurrently; continuing"
            return 0
        fi
        fail "Failed to register source $source_name"
        printf '%s\n' "$response" >&2
        return 1
    fi

    log "Source registered: $source_name"
}

# Migration state is a hard prerequisite for permissions and relationships that
# reference the table being migrated. This mirrors `hasura migrate apply` before
# `hasura metadata apply` in the standard CLI workflow.
validate_migrations() {
    local tenant="$1"
    local source_name="$2"
    local migrations_dir="$MIGRATIONS_DIR/$source_name"
    local status_output

    if [[ ! -d "$migrations_dir" ]]; then
        migrations_dir="$MIGRATIONS_DIR/$tenant"
    fi

    if [[ ! -d "$migrations_dir" ]]; then
        fail "No migrations directory found for '$source_name' under $MIGRATIONS_DIR"
        fail "Refusing to apply permissions/relationships for an unmigrated tenant."
        return 1
    fi

    log "Validating migration state for $source_name..."
    if ! status_output=$(cd "$ROOT_DIR" && \
        HASURA_GRAPHQL_ENDPOINT="$HASURA_ENDPOINT" \
        HASURA_GRAPHQL_ADMIN_SECRET="$HASURA_ADMIN_SECRET" \
        "$HASURA_CLI" migrate status \
            --database-name "$source_name" \
            --project "$ROOT_DIR" \
            --disable-interactive \
            --no-color \
            --skip-update-check 2>&1); then
        fail "Could not read migration status for $source_name"
        printf '%s\n' "$status_output" >&2
        return 1
    fi

    printf '%s\n' "$status_output" >&2

    # `hasura migrate status` prints SOURCE STATUS and DATABASE STATUS columns.
    # Match those columns instead of the migration name (a migration may contain
    # the word "pending" in its name).
    if printf '%s\n' "$status_output" | awk '
        $NF == "Pending" { bad = 1 }
        $(NF - 1) == "Not" && $NF == "Present" { bad = 1 }
        END { exit bad ? 0 : 1 }
    '; then
        fail "Migrations are not fully applied for '$source_name'."
        fail "Run 'hasura migrate apply --database-name $source_name' before deploying metadata."
        return 1
    fi

    log "Migrations are up to date for $source_name"
}

apply_full_metadata() {
    local desired_file="$1"
    local payload_file="$2"

    if ! jq -n --slurpfile metadata "$desired_file" \
        '{type:"replace_metadata", args:{metadata:$metadata[0], allow_inconsistent_metadata:false}}' \
        > "$payload_file"; then
        fail "Failed to build replace_metadata payload"
        return 1
    fi

    log "Applying full metadata (configuration, permissions, relationships, event triggers)..."
    if ! metadata_api_request "$payload_file" "replace_metadata" >/dev/null; then
        fail "Metadata was not applied; the server keeps its previous metadata."
        return 1
    fi
    log "Metadata applied successfully"
}

verify_metadata_consistency() {
    local response
    if ! response=$(metadata_api_request '{"type":"get_inconsistent_metadata","args":{}}' \
        "get_inconsistent_metadata"); then
        return 1
    fi

    if ! printf '%s' "$response" | jq -e '
        .is_consistent == true and ((.inconsistent_objects // []) | length) == 0
    ' >/dev/null 2>&1; then
        fail "Metadata is inconsistent after deployment"
        printf '%s' "$response" | jq -r '
            (.inconsistent_objects // [])[]?
            | "  - " + ((.reason // .definition // .type // "unknown") | tostring)
        ' >&2 || true
        printf '%s\n' "$response" >&2
        return 1
    fi

    log "Metadata consistency verified (get_inconsistent_metadata)"
}

graphql_request() {
    local role="$1"
    local query="$2"
    local response
    local http_code
    local body

    if ! response=$(curl -sS -w $'\n%{http_code}' \
        -X POST "${HASURA_ENDPOINT}/v1/graphql" \
        -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
        -H "X-Hasura-Role: ${role}" \
        -H "X-Hasura-User-Id: 00000000-0000-0000-0000-000000000000" \
        -H "Content-Type: application/json" \
        -d "$query" 2>&1); then
        fail "GraphQL role check failed for role '$role': could not reach ${HASURA_ENDPOINT}/v1/graphql"
        printf '%s\n' "$response" >&2
        return 1
    fi

    http_code="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if [[ "$http_code" != "200" ]]; then
        fail "GraphQL role check failed for role '$role' (HTTP ${http_code})"
        printf '%s\n' "$body" >&2
        return 1
    fi

    printf '%s' "$body"
}

# Verifies representative guest/host operations, not only admin introspection:
# the role must be able to introspect its schema and run a select against a
# table for which it has a select permission.
verify_role_schemas() {
    local source_file="$1"
    local roles
    local role
    local table_field
    local introspect_query
    local operation_query
    local response
    local verified=()
    local guest_found=false
    local host_found=false

    if [[ "$SKIP_ROLE_CHECKS" == "true" ]]; then
        warn "Role schema verification skipped (--skip-role-checks)"
        return 0
    fi

    if ! roles=$(jq -r '
        [
          (.tables[]? | (.select_permissions[]?.role,
                          .insert_permissions[]?.role,
                          .update_permissions[]?.role,
                          .delete_permissions[]?.role)),
          (.functions[]? | .permissions[]?.role)
        ] | flatten | map(select(. != null and . != "")) | unique[]
    ' "$source_file"); then
        fail "Failed to extract roles from desired metadata"
        return 1
    fi

    if [[ -z "$roles" ]]; then
        warn "No role permissions found in metadata; skipping role checks"
        return 0
    fi

    introspect_query='{"query":"query RoleSchemaProbe { __schema { queryType { name } } }"}'

    while IFS= read -r role; do
        [[ -n "$role" ]] || continue

        if ! response=$(graphql_request "$role" "$introspect_query"); then
            fail "Role '$role' cannot introspect the deployed schema"
            return 1
        fi
        if ! printf '%s' "$response" | jq -e '
            ((.errors // []) | length) == 0
            and (.data.__schema.queryType.name? == "query_root")
        ' >/dev/null 2>&1; then
            fail "Role '$role' does not see a valid query root after deployment"
            printf '%s\n' "$response" >&2
            return 1
        fi

        if [[ "$role" == "guest" ]]; then guest_found=true; fi
        if [[ "$role" == "host" ]]; then host_found=true; fi

        if [[ "$role" == "guest" || "$role" == "host" ]]; then
            if ! table_field=$(jq -r --arg role "$role" '
                [ .tables[]?
                  | select((.select_permissions // []) | any(
                      .role == $role
                      and (((.permission.columns? // "*") == "*")
                           or (((.permission.columns? // []) | length) > 0))
                    ))
                  | ((.configuration.custom_name? // .table.name) // empty)
                ] | first // empty
            ' "$source_file"); then
                fail "Failed to find a select-permitted table for role '$role'"
                return 1
            fi

            if [[ -n "$table_field" && "$table_field" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
                if ! operation_query=$(jq -cn --arg field "$table_field" \
                    '{query: ("query RoleOperationProbe { " + $field + "(limit: 0) { __typename } }")}'); then
                    fail "Failed to build role operation query for role '$role'"
                    return 1
                fi
                if ! response=$(graphql_request "$role" "$operation_query"); then
                    fail "Role '$role' cannot run an operation on '$table_field'"
                    return 1
                fi
                if ! printf '%s' "$response" | jq -e --arg field "$table_field" '
                    ((.errors // []) | length) == 0 and (.data | type == "object") and (.data | has($field))
                ' >/dev/null 2>&1; then
                    fail "Role '$role' operation on '$table_field' returned errors"
                    printf '%s\n' "$response" >&2
                    return 1
                fi
                verified+=("$role:$table_field")
            fi
        fi
    done <<< "$roles"

    if [[ "$guest_found" == "false" ]]; then
        warn "No guest permissions found in this tenant's metadata"
    fi
    if [[ "$host_found" == "false" ]]; then
        warn "No host permissions found in this tenant's metadata"
    fi

    if [[ ${#verified[@]} -gt 0 ]]; then
        log "Role checks passed: ${verified[*]}"
    else
        log "Role schema introspection passed for: $(printf '%s' "$roles" | tr '\n' ' ')"
    fi
}

metadata_counts() {
    local source_file="$1"
    jq -r '
        "tables=\((.tables // []) | length) " +
        "functions=\((.functions // []) | length) " +
        "permissions=\([(.tables[]? | ((.select_permissions // []) | length) +
                                       ((.insert_permissions // []) | length) +
                                       ((.update_permissions // []) | length) +
                                       ((.delete_permissions // []) | length))] | add // 0) " +
        "relationships=\([(.tables[]? | ((.object_relationships // []) | length) +
                                         ((.array_relationships // []) | length))] | add // 0) " +
        "event_triggers=\([(.tables[]? | (.event_triggers // []) | length)] | add // 0)"
    ' "$source_file"
}

deploy_tenant() {
    local tenant="$1"
    local tenant_start=$SECONDS
    local temp_dir
    local source_name
    local exported_file
    local exported_body
    local source_file
    local overlay_file
    local desired_file
    local payload_file

    temp_dir=$(mktemp -d)
    exported_file="$temp_dir/exported-metadata.json"
    source_file="$temp_dir/desired-source.json"
    overlay_file="$temp_dir/shared-overlay.json"
    desired_file="$temp_dir/desired-metadata.json"
    payload_file="$temp_dir/replace-payload.json"

    log "==========================================="
    log "Deploying complete metadata for tenant: $tenant"
    log "==========================================="

    if [[ ! -d "$BUILD_DIR/$tenant" ]]; then
        fail "No metadata found for tenant '$tenant'. Run build-metadata.sh first."
        rm -rf "$temp_dir"
        return 1
    fi

    if ! source_name=$(resolve_source_name "$tenant" "$BUILD_DIR/$tenant"); then
        rm -rf "$temp_dir"
        return 1
    fi
    log "Hasura source: $source_name"

    if ! build_desired_source "$BUILD_DIR/$tenant" "$source_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! build_shared_overlay "$BUILD_DIR/$tenant" "$overlay_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! exported_body=$(export_metadata); then
        rm -rf "$temp_dir"
        return 1
    fi
    printf '%s' "$exported_body" > "$exported_file"

    if ! ensure_source_registered "$source_name" "$source_file" "$exported_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! validate_migrations "$tenant" "$source_name"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! assemble_full_metadata "$source_name" "$exported_file" "$source_file" \
        "$overlay_file" "$desired_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! apply_full_metadata "$desired_file" "$payload_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! verify_metadata_consistency; then
        rm -rf "$temp_dir"
        return 1
    fi

    if ! verify_role_schemas "$source_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    local counts
    counts=$(metadata_counts "$source_file")
    local tenant_elapsed=$((SECONDS - tenant_start))
    log "✅ Deployment complete for $source_name (${counts})"
    log "⏱️  Deploy time for $source_name: ${tenant_elapsed}s"

    rm -rf "$temp_dir"
    return 0
}

usage() {
    cat <<'USAGE'
Usage: ./deploy-tenant.sh tenant1 [tenant2 ...] [options]

Applies the complete Hasura metadata for each tenant: source, tables,
permissions, relationships, event triggers, functions, and shared metadata.

Options:
  --endpoint URL       Hasura endpoint (default: $HASURA_GRAPHQL_ENDPOINT or
                       http://localhost:8080)
  --admin-secret SECRET
                       Admin secret (prefer the HASURA_GRAPHQL_ADMIN_SECRET
                       environment variable so the value is not visible in
                       process listings or shell history)
  --cloud              Require an explicit, non-local https endpoint. Use this
                       for Hasura Cloud targets; local defaults stay localhost.
  --skip-role-checks   Skip post-deploy guest/host role verification
  --build-dir DIR      Built metadata directory (default: metadata/build)
  --migrations-dir DIR Migrations directory (default: <repo>/migrations)
  -h, --help           Show this help

Environment:
  HASURA_GRAPHQL_ENDPOINT       Default Hasura endpoint
  HASURA_GRAPHQL_ADMIN_SECRET   Admin secret
  HASURA_CLI                    Hasura CLI executable (default: hasura)
  BUILD_DIR                     Built metadata directory
  MIGRATIONS_DIR                Migrations directory

Examples:
  ./deploy-tenant.sh safetrust
  ./deploy-tenant.sh safetrust hotel_industry --endpoint http://localhost:8080
  HASURA_GRAPHQL_ADMIN_SECRET=... ./deploy-tenant.sh safetrust \
    --cloud --endpoint https://example.hasura.app
USAGE
}

validate_target() {
    if [[ -z "$HASURA_ENDPOINT" ]]; then
        fail "Hasura endpoint is empty"
        return 1
    fi

    HASURA_ENDPOINT="${HASURA_ENDPOINT%/}"
    if [[ "$HASURA_ENDPOINT" == */v1/graphql ]]; then
        HASURA_ENDPOINT="${HASURA_ENDPOINT%/v1/graphql}"
    fi

    if [[ -z "$HASURA_ADMIN_SECRET" ]]; then
        fail "Hasura admin secret is empty. Set HASURA_GRAPHQL_ADMIN_SECRET."
        return 1
    fi

    if [[ "$CLOUD_TARGET" == "true" ]]; then
        if [[ "$HASURA_ENDPOINT" != https://* ]]; then
            fail "--cloud requires an explicit https Hasura Cloud endpoint"
            return 1
        fi

        local endpoint_host="${HASURA_ENDPOINT#*://}"
        endpoint_host="${endpoint_host%%/*}"
        endpoint_host="${endpoint_host%%:*}"

        if [[ "$endpoint_host" =~ ^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$ ]]; then
            fail "--cloud cannot target the local endpoint '$HASURA_ENDPOINT'"
            return 1
        fi

        if [[ "$ADMIN_SECRET_EXPLICIT" != "true" ]]; then
            fail "--cloud requires an explicit admin secret (HASURA_GRAPHQL_ADMIN_SECRET or --admin-secret)"
            return 1
        fi

        if [[ "$HASURA_ADMIN_SECRET" == "myadminsecretkey" ]]; then
            fail "--cloud cannot use the local default admin secret"
            return 1
        fi
    fi
}

main() {
    local tenants=()
    local main_start=$SECONDS

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --endpoint)
                if [[ $# -lt 2 || -z "${2:-}" ]]; then
                    fail "--endpoint requires a value"
                    exit 1
                fi
                HASURA_ENDPOINT="$2"
                shift 2
                ;;
            --admin-secret)
                if [[ $# -lt 2 || -z "${2:-}" ]]; then
                    fail "--admin-secret requires a value"
                    exit 1
                fi
                HASURA_ADMIN_SECRET="$2"
                ADMIN_SECRET_EXPLICIT=true
                shift 2
                ;;
            --cloud)
                CLOUD_TARGET=true
                shift
                ;;
            --skip-role-checks)
                SKIP_ROLE_CHECKS=true
                shift
                ;;
            --build-dir)
                if [[ $# -lt 2 || -z "${2:-}" ]]; then
                    fail "--build-dir requires a value"
                    exit 1
                fi
                BUILD_DIR="$2"
                shift 2
                ;;
            --migrations-dir)
                if [[ $# -lt 2 || -z "${2:-}" ]]; then
                    fail "--migrations-dir requires a value"
                    exit 1
                fi
                MIGRATIONS_DIR="$2"
                shift 2
                ;;
            -h | --help)
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

    if ! require_tools; then
        exit 1
    fi
    if ! validate_target; then
        exit 1
    fi

    echo "Hasura target: ${HASURA_ENDPOINT}"
    echo "Metadata build directory: ${BUILD_DIR}"
    if [[ "$CLOUD_TARGET" == "true" ]]; then
        echo "Target mode: Hasura Cloud (explicit endpoint)"
    else
        echo "Target mode: local/self-hosted"
    fi
    echo "Deploying metadata for tenants: ${tenants[*]}"
    echo ""

    local successful_tenants=()
    local failed_tenants=()

    # Metadata is replaced as a full document, so deploys must be serialized:
    # concurrent exports/replaces can otherwise overwrite each other's sources.
    for tenant in "${tenants[@]}"; do
        if deploy_tenant "$tenant"; then
            successful_tenants+=("$tenant")
        else
            failed_tenants+=("$tenant")
        fi
    done

    local total_elapsed=$((SECONDS - main_start))

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
