#!/usr/bin/env bash
set -eo pipefail # Exit on error and if any command in a pipeline fails

# Configuration — paths relative to the script location, not the calling directory
# This ensures bin/start and setup-tenant.sh can call this script from any directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/base"
TENANTS_DIR="$SCRIPT_DIR/tenants"
BUILD_DIR="$SCRIPT_DIR/build"
YAML_MERGE_TOOL="yq" # Make sure yq is installed: https://github.com/mikefarah/yq


if ! command -v "$YAML_MERGE_TOOL" &> /dev/null; then
    echo "❌ Error: $YAML_MERGE_TOOL is required but not installed."
    echo "ℹ️ Please install it with: pip install yq or brew install yq"
    exit 1
fi


if [ ! -d "$BASE_DIR" ]; then
    echo "❌ Error: Base directory $BASE_DIR not found!"
    echo "ℹ️ Please make sure your project structure is correct."
    exit 1
fi


merge_yaml() {
    local source_file="$1"
    local target_file="$2"
    local output_file="$3"

    if [ -f "$source_file" ] && [ -f "$target_file" ]; then
        # Merge the files with yq
        $YAML_MERGE_TOOL eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' "$target_file" "$source_file" > "$output_file"
    elif [ -f "$source_file" ]; then
        cp "$source_file" "$output_file"
    elif [ -f "$target_file" ]; then
        cp "$target_file" "$output_file"
    fi
}


copy_with_merge() {
    local source_dir="$1"
    local target_dir="$2"

    mkdir -p "$target_dir"

    for file in "$source_dir"/*; do
        if [ -d "$file" ]; then
            # If it's a directory, recurse
            dir_name=$(basename "$file")
            copy_with_merge "$file" "$target_dir/$dir_name"
        elif [ -f "$file" ]; then
            file_name=$(basename "$file")
            file_ext="${file_name##*.}"

            if [ "$file_ext" = "yaml" ] || [ "$file_ext" = "yml" ]; then
                if [ -f "$target_dir/$file_name" ]; then
                    merge_yaml "$file" "$target_dir/$file_name" "$target_dir/$file_name.tmp"
                    mv "$target_dir/$file_name.tmp" "$target_dir/$file_name"
                else
                    cp "$file" "$target_dir/$file_name"
                fi
            else
                cp "$file" "$target_dir/$file_name"
            fi
        fi
    done
}


build_tenant() {
    local tenant="$1"
    echo "⚙️ Building metadata for tenant: $tenant"

    # Validate tenant argument — only allow safe directory names
    if [[ ! "$tenant" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
        echo "❌ Error: Invalid tenant name '$tenant'. Must start with a letter and contain only alphanumeric, underscore, or hyphen characters."
        return 1
    fi

    if [ ! -d "$TENANTS_DIR/$tenant" ]; then
        echo "❌ Error: Tenant directory $TENANTS_DIR/$tenant not found!"
        return 1
    fi

    # Ensure BUILD_DIR exists before path traversal check
    mkdir -p "$BUILD_DIR"

    # Guard against path traversal — ensure resolved path stays within BUILD_DIR
    local target_path
    target_path="$(cd "$BUILD_DIR" && pwd)/$tenant"
    local build_dir_canonical
    build_dir_canonical="$(cd "$BUILD_DIR" && pwd)"

    if [[ "$target_path" != "$build_dir_canonical"/* ]]; then
        echo "❌ Error: Tenant path escapes BUILD_DIR boundary"
        return 1
    fi

    rm -rf -- "${BUILD_DIR:?}/$tenant"
    mkdir -p "$BUILD_DIR/$tenant"

    echo "⚙️ Copying base metadata..."
    cp -r "$BASE_DIR"/* "$BUILD_DIR/$tenant/"

    echo "⚙️ Applying tenant-specific metadata..."
    copy_with_merge "$TENANTS_DIR/$tenant" "$BUILD_DIR/$tenant"

    if [ -f "$TENANTS_DIR/$tenant/tenant_overrides.yaml" ]; then
        echo "⚙️ Applying tenant overrides..."

        find "$BUILD_DIR/$tenant" -name "*.yaml" -type f | while read -r yaml_file; do
            relative_path="${yaml_file#$BUILD_DIR/$tenant/}"
            yaml_path=$(dirname "$relative_path")

            # Single yq call: attempt merge directly
            # If the path does not exist in overrides, yq outputs the base file unchanged
            if merged=$($YAML_MERGE_TOOL eval-all 'select(fileIndex == 0) * (select(fileIndex == 1)."'"$yaml_path"'" // {})' "$yaml_file" "$TENANTS_DIR/$tenant/tenant_overrides.yaml" 2>/dev/null); then
                echo "$merged" > "$yaml_file"
            fi
        done
    fi

    echo "✅ Build complete for $tenant"
    return 0
}


TENANT="$1"


if [ -n "$TENANT" ]; then
    if ! build_tenant "$TENANT"; then
        exit 1
    fi
else
    echo "⚙️ Building metadata for all tenants..."

    if [ ! -d "$TENANTS_DIR" ]; then
        echo "❌ Error: Tenants directory $TENANTS_DIR not found!"
        exit 1
    fi

    found=0
    while IFS= read -r -d '' tenant_dir; do
        found=1
        tenant=$(basename "$tenant_dir")
        if ! build_tenant "$tenant"; then
            echo "❌ Error: Failed to build tenant: $tenant"
            continue
        fi
    done < <(find "$TENANTS_DIR" -maxdepth 1 -mindepth 1 -type d -print0)

    if [ "$found" -eq 0 ]; then
        echo "❌ Error: No tenant directories found in $TENANTS_DIR"
        exit 1
    fi
fi

echo "✅ Metadata build process completed successfully!"