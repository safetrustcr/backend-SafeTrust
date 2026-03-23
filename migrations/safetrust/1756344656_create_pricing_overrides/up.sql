
-- Create SafeTrust Pricing Overrides Table
CREATE TABLE pricing_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    override_name VARCHAR(100) NOT NULL,
    base_rule_id UUID REFERENCES pricing_rules(id) ON DELETE CASCADE,
    override_percentage DECIMAL(5,4),
    override_base_amount DECIMAL(20,7),
    effective_from TIMESTAMPTZ,
    effective_until TIMESTAMPTZ,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    user_tier VARCHAR(50),
    min_transaction_amount DECIMAL(20,7),
    max_transaction_amount DECIMAL(20,7),
    user_id_list TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pricing_overrides_base_rule ON pricing_overrides(base_rule_id);
CREATE INDEX idx_pricing_overrides_active ON pricing_overrides(is_active);
CREATE INDEX idx_pricing_overrides_priority ON pricing_overrides(priority);
CREATE INDEX idx_pricing_overrides_user_tier ON pricing_overrides(user_tier);
CREATE INDEX idx_pricing_overrides_effective_dates ON pricing_overrides(effective_from, effective_until);
CREATE INDEX idx_pricing_overrides_amount_range ON pricing_overrides(min_transaction_amount, max_transaction_amount);
CREATE UNIQUE INDEX idx_pricing_overrides_name_unique ON pricing_overrides(override_name);

-- Trigger function
CREATE OR REPLACE FUNCTION update_pricing_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_pricing_overrides_updated_at
    BEFORE UPDATE ON pricing_overrides
    FOR EACH ROW
    EXECUTE FUNCTION update_pricing_overrides_updated_at();

-- Comments
COMMENT ON TABLE pricing_overrides IS 'Comprehensive pricing override system for SafeTrust tenant';
COMMENT ON COLUMN pricing_overrides.override_name IS 'Human-readable name for the override';
COMMENT ON COLUMN pricing_overrides.base_rule_id IS 'Reference to the base pricing rule being overridden';
COMMENT ON COLUMN pricing_overrides.override_percentage IS 'Percentage-based override (e.g., 0.025 = 2.5%)';
COMMENT ON COLUMN pricing_overrides.override_base_amount IS 'Fixed amount override (e.g., $0.50)';
COMMENT ON COLUMN pricing_overrides.effective_from IS 'Start date for time-based overrides';
COMMENT ON COLUMN pricing_overrides.effective_until IS 'End date for time-based overrides';
COMMENT ON COLUMN pricing_overrides.priority IS 'Override priority (higher number = higher priority)';
COMMENT ON COLUMN pricing_overrides.user_tier IS 'User tier for tier-based overrides';
COMMENT ON COLUMN pricing_overrides.min_transaction_amount IS 'Minimum transaction amount for amount-based overrides';
COMMENT ON COLUMN pricing_overrides.max_transaction_amount IS 'Maximum transaction amount for amount-based overrides';
COMMENT ON COLUMN pricing_overrides.user_id_list IS 'Array of specific user IDs for targeted promotions';