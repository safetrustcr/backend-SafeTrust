#!/usr/bin/env bash
# Least-privilege PostgreSQL roles for the SafeTrust stack.
#
# Runs as the postgres superuser when the data directory is empty
# (docker-entrypoint-initdb.d), and bin/start re-runs it on every start — the
# script is idempotent — so an existing volume also gets these roles.
#
# Roles:
#   postgres         admin — migrations only (bin/start, migrate-test), never a
#                    running service
#   hasura           Hasura data source — tenant schemas (safetrust,
#                    hotel_industry) only; never superuser
#   hasura_metadata  owns the separate hasura_metadata database (Hasura catalog)
#   webhook          webhook — SELECT/INSERT/UPDATE/DELETE on safetrust only,
#                    no CREATE, no superuser, no COPY … PROGRAM
#
# Passwords always come from the environment (Compose env or *_FILE secret);
# this file never contains a literal credential.
set -euo pipefail

: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=postgres}"
: "${HASURA_DB_PASSWORD:?HASURA_DB_PASSWORD is required}"
: "${HASURA_METADATA_DB_PASSWORD:?HASURA_METADATA_DB_PASSWORD is required}"
: "${WEBHOOK_DB_PASSWORD:?WEBHOOK_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --quiet \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    -v app_db="$POSTGRES_DB" \
    -v hasura_password="$HASURA_DB_PASSWORD" \
    -v metadata_password="$HASURA_METADATA_DB_PASSWORD" \
    -v webhook_password="$WEBHOOK_DB_PASSWORD" <<'SQL'
-- ── Roles ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hasura') THEN
        CREATE ROLE hasura LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hasura_metadata') THEN
        CREATE ROLE hasura_metadata LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webhook') THEN
        CREATE ROLE webhook LOGIN;
    END IF;
END
$$;

ALTER ROLE hasura
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD :'hasura_password';
ALTER ROLE hasura_metadata
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD :'metadata_password';
ALTER ROLE webhook
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD :'webhook_password';

-- ── Connection scope ─────────────────────────────────────────────────────────
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_db" TO hasura, webhook;

-- ── Hasura metadata lives in its own database, owned by hasura_metadata ──────
SELECT format('CREATE DATABASE %I OWNER %I', 'hasura_metadata', 'hasura_metadata')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'hasura_metadata')
\gexec
REVOKE ALL ON DATABASE hasura_metadata FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE hasura_metadata TO hasura_metadata;

-- ── Tenant schemas ───────────────────────────────────────────────────────────
-- Migrations run as the hasura role, which has no CREATE on the database, and
-- extensions need the superuser (or database CREATE for trusted ones). Install
-- them here so each migration's CREATE EXTENSION IF NOT EXISTS is a no-op.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS safetrust;
CREATE SCHEMA IF NOT EXISTS hotel_industry;

GRANT USAGE ON SCHEMA safetrust, hotel_industry TO hasura;
GRANT USAGE ON SCHEMA safetrust TO webhook;

-- Hasura owns the tables it tracks, but on a database that was migrated by the
-- admin role these grants are what let it read and write them.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA safetrust, hotel_industry TO hasura;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA safetrust, hotel_industry TO hasura;

-- The webhook gets DML on the tables it uses and nothing else: no CREATE, no
-- TRUNCATE, no REFERENCES/TRIGGER, no access to hotel_industry or public.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA safetrust TO webhook;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA safetrust TO webhook;

-- Future tables created by the hasura role (i.e. by migrations) inherit the
-- webhook grants, so a new tenant table needs no manual GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE hasura IN SCHEMA safetrust
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO webhook;
ALTER DEFAULT PRIVILEGES FOR ROLE hasura IN SCHEMA safetrust
    GRANT USAGE, SELECT ON SEQUENCES TO webhook;

-- No CREATE for the hasura role: migrations are the only step that needs DDL,
-- so bin/start and bin/prepare-test-db grant CREATE on the tenant schemas — and
-- on `public`, where migration 1779300000001 stages legacy tables — immediately
-- before applying migrations and revoke it immediately after. A stack that is
-- merely `docker compose up`-ed therefore never has a role that can create or
-- drop objects. tests/db/assert-webhook-role.sh checks the window is closed.
GRANT USAGE ON SCHEMA public TO hasura;

-- Tenant schemas first on the search path for both runtime roles.
ALTER ROLE hasura SET search_path TO safetrust, hotel_industry, public;
ALTER ROLE webhook SET search_path TO safetrust, public;
SQL

echo "[init-roles] created roles hasura, hasura_metadata, webhook (non-superuser)"
