-- Insert a tenant-specific override for the platform fee on USDC
-- This demonstrates how a specific tenant can have unique pricing
INSERT INTO shared.tenant_pricing_overrides (tenant_id, pricing_rule_id, override_percentage)
SELECT
    '550e8400-e29b-41d4-a716-446655440000'::UUID, -- Placeholder tenant_id
    id,
    0.015 -- New percentage (1.5%) instead of default 2.5%
FROM shared.pricing_rules
WHERE rule_name = 'platform_fee_usdc';

-- Insert another example override for XLM platform fee
INSERT INTO shared.tenant_pricing_overrides (tenant_id, pricing_rule_id, override_percentage)
SELECT
    '550e8400-e29b-41d4-a716-446655440000'::UUID, -- Same placeholder tenant_id
    id,
    0.020 -- New percentage (2.0%) instead of default 2.5%
FROM shared.pricing_rules
WHERE rule_name = 'platform_fee_xlm';

-- Insert a different tenant with different overrides to show variety
INSERT INTO shared.tenant_pricing_overrides (tenant_id, pricing_rule_id, override_percentage)
SELECT
    '660e8400-e29b-41d4-a716-446655440001'::UUID, -- Different placeholder tenant_id
    id,
    0.030 -- Higher percentage (3.0%) for premium tenant
FROM shared.pricing_rules
WHERE rule_name = 'platform_fee_usdc';
