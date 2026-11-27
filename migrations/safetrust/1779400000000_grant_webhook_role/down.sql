DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webhook') THEN
        RETURN;
    END IF;

    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA safetrust FROM webhook';
    EXECUTE 'REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA safetrust FROM webhook';
END;
$migration$;
