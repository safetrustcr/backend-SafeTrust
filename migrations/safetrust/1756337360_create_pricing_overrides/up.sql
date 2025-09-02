-- Create SafeTrust Pricing Overrides Table
-- This table allows for comprehensive pricing override scenarios including
-- promotional campaigns, user-tier discounts, time-limited offers, and enterprise pricing

CREATE TABLE safetrust.pricing_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    override_name VARCHAR(100) NOT NULL,
    base_rule_id UUID REFERENCES shared.pricing_rules(id) ON DELETE CASCADE,
    override_percentage DECIMAL(5,4), -- e.g., 0.025 = 2.5%
    override_base_amount DECIMAL(20,7), -- Fixed amount override
    effective_from TIMESTAMPTZ, -- Start date for time-based overrides
    effective_until TIMESTAMPTZ, -- End date for time-based overrides
    priority INTEGER DEFAULT 0, -- Higher number = higher priority
    is_active BOOLEAN DEFAULT true,
    user_tier VARCHAR(50), -- 'PREMIUM', 'ENTERPRISE', 'VIP', etc.
    min_transaction_amount DECIMAL(20,7), -- Minimum amount for amount-based overrides
    max_transaction_amount DECIMAL(20,7), -- Maximum amount for amount-based overrides
    user_id_list TEXT[], -- Array of specific user IDs for targeted promotions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_pricing_overrides_base_rule ON safetrust.pricing_overrides(base_rule_id);
CREATE INDEX idx_pricing_overrides_active ON safetrust.pricing_overrides(is_active);
CREATE INDEX idx_pricing_overrides_priority ON safetrust.pricing_overrides(priority);
CREATE INDEX idx_pricing_overrides_user_tier ON safetrust.pricing_overrides(user_tier);
CREATE INDEX idx_pricing_overrides_effective_dates ON safetrust.pricing_overrides(effective_from, effective_until);
CREATE INDEX idx_pricing_overrides_amount_range ON safetrust.pricing_overrides(min_transaction_amount, max_transaction_amount);

-- Create unique constraint to prevent duplicate override names
CREATE UNIQUE INDEX idx_pricing_overrides_name_unique ON safetrust.pricing_overrides(override_name);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pricing_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_pricing_overrides_updated_at
    BEFORE UPDATE ON safetrust.pricing_overrides
    FOR EACH ROW
    EXECUTE FUNCTION update_pricing_overrides_updated_at();

-- Add comments for documentation
COMMENT ON TABLE safetrust.pricing_overrides IS 'Comprehensive pricing override system for SafeTrust tenant';
COMMENT ON COLUMN safetrust.pricing_overrides.override_name IS 'Human-readable name for the override';
COMMENT ON COLUMN safetrust.pricing_overrides.base_rule_id IS 'Reference to the base pricing rule being overridden';
COMMENT ON COLUMN safetrust.pricing_overrides.override_percentage IS 'Percentage-based override (e.g., 0.025 = 2.5%)';
COMMENT ON COLUMN safetrust.pricing_overrides.override_base_amount IS 'Fixed amount override (e.g., $0.50)';
COMMENT ON COLUMN safetrust.pricing_overrides.effective_from IS 'Start date for time-based overrides';
COMMENT ON COLUMN safetrust.pricing_overrides.effective_until IS 'End date for time-based overrides';
COMMENT ON COLUMN safetrust.pricing_overrides.priority IS 'Override priority (higher number = higher priority)';
COMMENT ON COLUMN safetrust.pricing_overrides.user_tier IS 'User tier for tier-based overrides';
COMMENT ON COLUMN safetrust.pricing_overrides.min_transaction_amount IS 'Minimum transaction amount for amount-based overrides';
COMMENT ON COLUMN safetrust.pricing_overrides.max_transaction_amount IS 'Maximum transaction amount for amount-based overrides';
COMMENT ON COLUMN safetrust.pricing_overrides.user_id_list IS 'Array of specific user IDs for targeted promotions';
