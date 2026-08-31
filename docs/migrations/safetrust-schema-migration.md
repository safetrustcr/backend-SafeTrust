# SafeTrust Schema Migration Strategy

## Why this migration exists

All SafeTrust tables were originally created in the PostgreSQL `public` schema.
This migration moves them to the `safetrust` schema to:

1. Enforce tenant data isolation at the schema permission level
2. Eliminate GraphQL `custom_name` workarounds for collision avoidance
3. Enable row-level security policies scoped to `safetrust.*`
4. Allow `GRANT USAGE ON SCHEMA safetrust` for fine-grained access control

## What was NOT changed

- No existing migration files were modified
- The migration sequence is preserved exactly
- All data is preserved — `ALTER TABLE ... SET SCHEMA` is non-destructive
- GraphQL API surface is unchanged — field names are identical after Hasura
  re-tracks tables under the new schema

## Deployment Sequence

### 1. Apply Database Migration
Apply the database schema migration using Hasura CLI:
```bash
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type up
```

### 2. Apply or Reload Hasura Metadata
Apply or reload the corresponding Hasura metadata to update table tracking under the `safetrust` schema:
```bash
hasura metadata apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

### 3. GraphQL Smoke Test
Run a GraphQL smoke test to verify queries and mutations are working as expected:
```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "x-hasura-admin-secret: myadminsecretkey" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { safetrust_reservations(limit: 1) { id } }"}'
```

## Rollback Strategy

In the event of a rollback:
1. Revert the database migration:
```bash
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type down
```
2. Restore and apply the previous Hasura metadata corresponding to the reverted schema.

