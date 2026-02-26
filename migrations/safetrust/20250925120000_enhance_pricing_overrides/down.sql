-- Down migration: Reverse enhance_pricing_overrides (constraints, indexes, column, trigger)
-- Issue: #188 - SafeTrust Pricing Overrides Enhancement

-- Drop trigger and function
DROP TRIGGER IF EXISTS update_safetrust_pricing_overrides_updated_at
ON safetrust.pricing_overrides;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop added indexes (safetrust.pricing_overrides)
DROP INDEX IF EXISTS safetrust.idx_safetrust_pricing_overrides_active_effective;
DROP INDEX IF EXISTS safetrust.idx_safetrust_pricing_overrides_base_rule;
DROP INDEX IF EXISTS safetrust.idx_safetrust_pricing_overrides_user_tier;
DROP INDEX IF EXISTS safetrust.idx_safetrust_pricing_overrides_effective_period;
DROP INDEX IF EXISTS safetrust.idx_safetrust_pricing_overrides_transaction_amounts;
DROP INDEX IF EXISTS safetrust.idx_safetrust_pricing_overrides_priority_active;

-- Drop added index on shared.pricing_rules
DROP INDEX IF EXISTS shared.idx_shared_pricing_rules_id_active;

-- Drop added constraints and column
ALTER TABLE safetrust.pricing_overrides
  DROP CONSTRAINT IF EXISTS check_override_values_specified,
  DROP CONSTRAINT IF EXISTS check_effective_dates,
  DROP CONSTRAINT IF EXISTS check_transaction_amounts,
  DROP COLUMN IF EXISTS updated_at;
