-- Drop SafeTrust Pricing Overrides Table
-- This will remove the table and all associated objects

-- Drop the trigger first
DROP TRIGGER IF EXISTS update_pricing_overrides_updated_at ON safetrust.pricing_overrides;

-- Drop the function
DROP FUNCTION IF EXISTS update_pricing_overrides_updated_at();

-- Drop the table (this will also drop all indexes and constraints)
DROP TABLE IF EXISTS safetrust.pricing_overrides CASCADE;
