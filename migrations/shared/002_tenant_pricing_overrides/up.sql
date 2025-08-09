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