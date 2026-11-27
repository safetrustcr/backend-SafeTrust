#!/usr/bin/env bash
# Proves the runtime database roles are least-privilege.
#
# Runs in the test stack after migrations (docker-compose-test.yml: db-privileges)
# and fails the build when the webhook role can escalate. Connect as the admin
# role and SET ROLE so the assertions test the role, not the admin session.
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=postgres}"

FAILED=0

# expect_denied <description> <sql> — the statement must fail with a permission error.
expect_denied() {
    local description="$1" sql="$2" err_file
    err_file="$(mktemp)"
    if psql -X -q -v ON_ERROR_STOP=1 -c "SET ROLE webhook; ${sql}" >/dev/null 2>"$err_file"; then
        echo "❌ webhook role was able to ${description}"
        FAILED=1
    elif grep -qiE "permission denied|must be superuser|not have permission" "$err_file"; then
        echo "✅ webhook role cannot ${description}"
    else
        echo "❌ unexpected error while checking '${description}':"
        cat "$err_file"
        FAILED=1
    fi
    rm -f "$err_file"
}

# expect_allowed <description> <sql> — the statement must succeed.
expect_allowed() {
    local description="$1" sql="$2"
    if psql -X -q -v ON_ERROR_STOP=1 -c "SET ROLE webhook; ${sql}" >/dev/null 2>&1; then
        echo "✅ webhook role can ${description}"
    else
        echo "❌ webhook role cannot ${description} — grants are missing"
        FAILED=1
    fi
}

echo "🔐 Checking database role privileges on ${PGHOST}/${PGDATABASE}..."

# The role is non-superuser and cannot create DDL objects anywhere.
expect_denied "CREATE TABLE in safetrust" "CREATE TABLE safetrust.should_not_exist (id integer);"
expect_denied "CREATE TABLE in public" "CREATE TABLE public.should_not_exist (id integer);"
expect_denied "CREATE SCHEMA" "CREATE SCHEMA should_not_exist;"
expect_denied "DROP a tenant table" "DROP TABLE safetrust.users;"
expect_denied "TRUNCATE a tenant table" "TRUNCATE safetrust.users;"

# COPY … PROGRAM is the escalation path the issue calls out (arbitrary commands
# as the postgres OS user).
expect_denied "COPY … TO PROGRAM" "COPY safetrust.users TO PROGRAM 'true';"
expect_denied "COPY … FROM PROGRAM" "COPY safetrust.users FROM PROGRAM 'true';"

# The DML it actually needs still works.
expect_allowed "read safetrust.users" "SELECT count(*) FROM safetrust.users;"

# Role flags.
for role in hasura hasura_metadata webhook; do
    row="$(psql -X -tA -v ON_ERROR_STOP=1 -c \
        "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = '${role}'")"
    if [[ "$row" == "f|f|f|f" ]]; then
        echo "✅ role ${role} is not superuser/createdb/createrole/replication"
    else
        echo "❌ role ${role} has elevated flags: ${row:-missing}"
        FAILED=1
    fi
done

if [[ "$(psql -X -tA -c "SELECT has_schema_privilege('webhook', 'safetrust', 'CREATE')")" == "f" ]]; then
    echo "✅ webhook role has no CREATE on schema safetrust"
else
    echo "❌ webhook role has CREATE on schema safetrust"
    FAILED=1
fi

if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ database role privilege check failed"
    exit 1
fi

echo "✅ database roles are least-privilege"
