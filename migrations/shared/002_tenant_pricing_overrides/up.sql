CREATE SCHEMA IF NOT EXISTS shared;

-- Tenant-specific pricing overrides
CREATE TABLE shared.tenant_pricing_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    pricing_rule_id UUID REFERENCES shared.pricing_rules(id),
    override_value DECIMAL(20,7),
    override_percentage DECIMAL(5,4),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_tenant_rule UNIQUE (tenant_id, pricing_rule_id)
);


-- Add data validation constraint
ALTER TABLE shared_config.tenant_pricing_overrides 
ADD CONSTRAINT check_override_specified 
CHECK (override_value IS NOT NULL OR override_percentage IS NOT NULL);

-- Add missing audit field for change tracking
ALTER TABLE shared_config.tenant_pricing_overrides 
ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create performance indexes for common query patterns
CREATE INDEX idx_tenant_pricing_overrides_tenant_active 
ON shared_config.tenant_pricing_overrides(tenant_id, is_active)
WHERE is_active = true;

CREATE INDEX idx_tenant_pricing_overrides_pricing_rule 
ON shared_config.tenant_pricing_overrides(pricing_rule_id, is_active)
WHERE is_active = true;

-- Add index to pricing_rules for better join performance
CREATE INDEX idx_pricing_rules_type_token_active 
ON shared_config.pricing_rules(rule_type, token, is_active)
WHERE is_active = true;

-- Add trigger for automatic updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenant_pricing_overrides_updated_at 
    BEFORE UPDATE ON shared_config.tenant_pricing_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();