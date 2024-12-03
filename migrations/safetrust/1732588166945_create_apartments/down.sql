-- Drop function
DROP FUNCTION IF EXISTS find_nearby_apartments;
DROP FUNCTION IF EXISTS update_updated_at_column;

-- Drop trigger
DROP TRIGGER IF EXISTS update_apartments_updated_at ON apartments;

-- Drop indexes
DROP INDEX IF EXISTS idx_apartments_coordinates;
DROP INDEX IF EXISTS idx_apartments_location_area;
DROP INDEX IF EXISTS idx_apartments_owner;
DROP INDEX IF EXISTS idx_apartments_availability;
DROP INDEX IF EXISTS idx_apartments_price;

-- Drop table
DROP TABLE IF EXISTS apartments;