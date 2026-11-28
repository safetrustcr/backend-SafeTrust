-- Database hardening — remove unused extensions and add a dedicated schema for
-- future extension installs.
--
-- Audit of usages (migrations/ and webhook/src/): nothing uses pgcrypto,
-- fuzzystrmatch, postgis_topology or postgis_tiger_geocoder. gen_random_uuid()
-- is built into PostgreSQL 13+, so pgcrypto is not needed either. Every
-- installed extension adds functions any connected role can call, so the
-- unused ones are dropped here.
--
-- Extensions that are still used — postgis (geography), pg_trgm
-- (gin_trgm_ops on apartments), uuid-ossp, btree_gist — stay in public. Moving
-- them is optional and skipped on purpose: existing column defaults and
-- operator classes were created against the public schema, and moving pg_trgm
-- or uuid-ossp would require every dependent default expression to be
-- rewritten. New extensions must be installed into the `extensions` schema.

DROP EXTENSION IF EXISTS postgis_topology CASCADE;
DROP EXTENSION IF EXISTS postgis_tiger_geocoder CASCADE;
DROP EXTENSION IF EXISTS fuzzystrmatch CASCADE;
DROP EXTENSION IF EXISTS pgcrypto CASCADE;

DROP SCHEMA IF EXISTS topology CASCADE; -- security-reviewed: remove the schema owned by the dropped postgis_topology extension
DROP SCHEMA IF EXISTS tiger CASCADE; -- security-reviewed: remove the schema owned by the dropped postgis_tiger_geocoder extension
DROP SCHEMA IF EXISTS tiger_data CASCADE; -- security-reviewed: remove the data schema owned by the dropped postgis_tiger_geocoder extension

CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA extensions IS
  'Dedicated schema for future extensions; kept off the service roles search_path so extension objects cannot shadow application objects';

-- Only the schema owner may create objects here, so no other role can shadow
-- an extension object by creating one earlier on a search path. USAGE is still
-- granted so existing objects remain callable.
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO PUBLIC; -- security-reviewed: allow calling extension objects without allowing new ones
