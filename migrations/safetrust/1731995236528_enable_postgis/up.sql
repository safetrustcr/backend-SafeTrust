-- Verify superuser privileges
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = current_user
        AND rolsuper = true
    ) THEN
        RAISE EXCEPTION 'Superuser privileges required to enable PostGIS';
    END IF;
END
$$;

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify installation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'postgis'
    ) THEN
        RAISE EXCEPTION 'PostGIS extension failed to install';
    END IF;
END
$$;