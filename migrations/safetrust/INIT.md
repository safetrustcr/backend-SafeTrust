# SafeTrust Schema Migration Strategy

## Why this migration exists
All SafeTrust tables were originally created in the PostgreSQL `public` schema. This migration moves them to the `safetrust` schema to:
1. Enforce tenant data isolation at the schema permission level
2. Eliminate GraphQL `custom_name` workarounds for collision avoidance
3. Enable row-level security policies scoped to `safetrust.*`
4. Allow `GRANT USAGE ON SCHEMA safetrust` for fine-grained access control

## What was NOT changed
- No existing migration files were modified
- The migration sequence is preserved exactly
- All data is preserved — `ALTER TABLE ... SET SCHEMA` is non-destructive
- GraphQL API surface is unchanged — field names are identical after Hasura re-tracks tables under the new schema

## Applying this migration to an existing database
```bash
hasura migrate apply \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey \
  --database-name safetrust \
  --version 1779300000001 \
  --type up
```
