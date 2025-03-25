-- Migration: Rollback Hotels Table for Hotel Industry Tenant
-- Purpose: Remove hotels table and associated indexes if needed

-- Drop performance indexes
DROP INDEX IF EXISTS idx_hotels_name;
DROP INDEX IF EXISTS idx_hotels_location_area;

-- Drop hotels table
DROP TABLE IF EXISTS hotels;

-- Optional: Remove UUID extension if no longer needed
-- DROP EXTENSION IF EXISTS "uuid-ossp";
