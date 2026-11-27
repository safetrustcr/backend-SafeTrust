-- Give the webhook role exactly the DML it needs on the tenant tables.
--
-- Tables created before migration 1779300000001 were staged in `public` and
-- moved here with ALTER TABLE … SET SCHEMA, so they never received the
-- ALTER DEFAULT PRIVILEGES grants for the webhook role. This migration, run by
-- the `hasura` data-source role, re-grants them.
-- It no-ops when the role does not exist (e.g. a database created before the
-- role init script ran), and warns instead of failing when a legacy table is
-- still owned by the admin role — in that case run
-- docker/postgres/init/01-init-roles.sh as the admin (see docs/infra/bin-start.md).
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webhook') THEN
        RAISE NOTICE 'role webhook does not exist — skipping webhook grants';
        RETURN;
    END IF;

    BEGIN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA safetrust TO webhook';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA safetrust TO webhook';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING 'hasura does not own every safetrust table; re-run docker/postgres/init/01-init-roles.sh as the admin role to grant webhook DML';
    END;
END;
$migration$;
