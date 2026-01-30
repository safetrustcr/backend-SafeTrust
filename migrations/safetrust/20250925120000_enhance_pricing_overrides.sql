-- Migration: Enhance SafeTrust pricing_overrides table
-- Issue: #188 - Data validation, performance optimization, and documentation
-- Author: Majormaxx

-- ============================================================================
-- SECTION 1: DATA VALIDATION CONSTRAINTS
-- ============================================================================

-- Constraint 1: Ensure at least one override value is specified
-- Prevents invalid records where all override fields are NULL
ALTER TABLE safetrust.pricing_overrides
ADD CONSTRAINT check_override_values_specified CHECK (
    override_base_amount IS NOT NULL OR
    override_percentage IS NOT NULL
);

-- Constraint 2: Validate effective date ranges
-- End date must be after start date when both are specified
ALTER TABLE safetrust.pricing_overrides
ADD CONSTRAINT check_effective_dates CHECK (
    effective_until IS NULL OR
    effective_from IS NULL OR
    effective_until > effective_from
);

-- Constraint 3: Validate transaction amount ranges
-- Maximum must be greater than or equal to minimum when both are specified
ALTER TABLE safetrust.pricing_overrides
ADD CONSTRAINT check_transaction_amounts CHECK (
    max_transaction_amount IS NULL OR
    min_transaction_amount IS NULL OR
    max_transaction_amount >= min_transaction_amount
);

-- ============================================================================
-- SECTION 2: ENSURE AUDIT FIELDS EXIST
-- ============================================================================

-- Add updated_at column if not already present (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'safetrust'
        AND table_name = 'pricing_overrides'
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE safetrust.pricing_overrides
        ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- ============================================================================
-- SECTION 3: PERFORMANCE INDEXES (Partial Indexes for Active Records)
-- ============================================================================

-- Index 1: Active overrides by effective dates and priority
-- Optimizes: Time-based promotional queries
CREATE INDEX IF NOT EXISTS idx_safetrust_pricing_overrides_active_effective
ON safetrust.pricing_overrides(is_active, effective_from, effective_until, priority)
WHERE is_active = true;

-- Index 2: Active overrides by base rule
-- Optimizes: Rule-based override lookups and joins
CREATE INDEX IF NOT EXISTS idx_safetrust_pricing_overrides_base_rule
ON safetrust.pricing_overrides(base_rule_id, is_active, priority)
WHERE is_active = true;

-- Index 3: Active overrides by user tier
-- Optimizes: User-tier specific pricing lookups
CREATE INDEX IF NOT EXISTS idx_safetrust_pricing_overrides_user_tier
ON safetrust.pricing_overrides(user_tier, is_active)
WHERE is_active = true AND user_tier IS NOT NULL;

-- Index 4: Effective period range queries
-- Optimizes: Date range filtering for promotions
CREATE INDEX IF NOT EXISTS idx_safetrust_pricing_overrides_effective_period
ON safetrust.pricing_overrides(effective_from, effective_until)
WHERE is_active = true;

-- Index 5: Transaction amount-based lookups
-- Optimizes: Amount-based override queries
CREATE INDEX IF NOT EXISTS idx_safetrust_pricing_overrides_transaction_amounts
ON safetrust.pricing_overrides(min_transaction_amount, max_transaction_amount, is_active)
WHERE is_active = true AND (min_transaction_amount IS NOT NULL OR max_transaction_amount IS NOT NULL);

-- Index 6: Priority ordering for active overrides
-- Optimizes: Priority-based override selection
CREATE INDEX IF NOT EXISTS idx_safetrust_pricing_overrides_priority_active
ON safetrust.pricing_overrides(priority, is_active, effective_from)
WHERE is_active = true;

-- ============================================================================
-- SECTION 4: FOREIGN KEY JOIN OPTIMIZATION
-- ============================================================================

-- Index on pricing_rules for optimized joins with overrides
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'shared'
        AND tablename = 'pricing_rules'
        AND indexname = 'idx_shared_pricing_rules_id_active'
    ) THEN
        CREATE INDEX idx_shared_pricing_rules_id_active
        ON shared.pricing_rules(id, is_active)
        WHERE is_active = true;
    END IF;
END $$;

-- ============================================================================
-- SECTION 5: AUTO-UPDATE TRIGGER
-- ============================================================================

-- Create or replace the update function (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger to ensure latest function is used
DROP TRIGGER IF EXISTS update_safetrust_pricing_overrides_updated_at
ON safetrust.pricing_overrides;

CREATE TRIGGER update_safetrust_pricing_overrides_updated_at
BEFORE UPDATE ON safetrust.pricing_overrides
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SECTION 6: DOCUMENTATION COMMENTS
-- ============================================================================

-- Enhanced table comment
COMMENT ON TABLE safetrust.pricing_overrides IS 
'Pricing overrides for SafeTrust tenant - enables promotional pricing, user-tier discounts, and time-limited offers within hybrid architecture. Enhanced with data validation, performance indexes, and audit trail.';

-- Enhanced column comments
COMMENT ON COLUMN safetrust.pricing_overrides.base_rule_id IS 
'Foreign key reference to shared.pricing_rules - base rule being overridden';

COMMENT ON COLUMN safetrust.pricing_overrides.user_tier IS 
'User tier for targeted pricing (PREMIUM, ENTERPRISE, VIP, etc.)';

COMMENT ON COLUMN safetrust.pricing_overrides.effective_from IS 
'Start date/time for time-limited promotional overrides';

COMMENT ON COLUMN safetrust.pricing_overrides.effective_until IS 
'End date/time for promotions (NULL = permanent override). Must be after effective_from.';

COMMENT ON COLUMN safetrust.pricing_overrides.priority IS 
'Override priority - lower numbers take precedence over higher numbers';

COMMENT ON COLUMN safetrust.pricing_overrides.min_transaction_amount IS 
'Minimum transaction amount for amount-based overrides. Must be <= max_transaction_amount.';

COMMENT ON COLUMN safetrust.pricing_overrides.max_transaction_amount IS 
'Maximum transaction amount for amount-based overrides. Must be >= min_transaction_amount.';

COMMENT ON COLUMN safetrust.pricing_overrides.updated_at IS 
'Automatic timestamp tracking for audit trail - updated via trigger on every modification';
