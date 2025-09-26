DROP TRIGGER IF EXISTS update_apartments_updated_at ON apartments;

DROP INDEX IF EXISTS idx_apartments_coordinates;
DROP INDEX IF EXISTS idx_apartments_location_area;
DROP INDEX IF EXISTS idx_apartments_owner;
DROP INDEX IF EXISTS idx_apartments_availability;
DROP INDEX IF EXISTS idx_apartments_price;

DROP TABLE IF EXISTS apartments CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column;