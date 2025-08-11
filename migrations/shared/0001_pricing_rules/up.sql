CREATE SCHEMA IF NOT EXISTS shared;

-- Pricing configuration table (shared across tenants)
CREATE TABLE shared.pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- 'BASE_FEE', 'PERCENTAGE_FEE', 'GAS_FEE', 'PLATFORM_FEE'
    token VARCHAR(10) NOT NULL,
    -- 'USDC', 'XLM', etc.
    base_amount DECIMAL(20,7) DEFAULT 0,
    percentage DECIMAL(5,4) DEFAULT 0, -- e.g., 0.025 = 2.5%
    min_amount DECIMAL(20,7) DEFAULT 0,
    max_amount DECIMAL(20,7) DEFAULT 999999999,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
