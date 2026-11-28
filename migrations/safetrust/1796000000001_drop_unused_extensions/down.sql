-- Best-effort reversal of the unused-extension cleanup. Prefer rolling
-- forward; re-creating these extensions is only needed for a legacy stack that
-- still depends on them.

DROP SCHEMA IF EXISTS extensions CASCADE; -- security-reviewed: revert the dedicated extension schema

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- security-reviewed: revert unused-extension removal
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch; -- security-reviewed: revert unused-extension removal
CREATE EXTENSION IF NOT EXISTS postgis_topology; -- security-reviewed: revert unused-extension removal
CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder; -- security-reviewed: revert unused-extension removal
