-- Create SafeTrust schema if not exists
CREATE SCHEMA IF NOT EXISTS safetrust;

-- Create SafeTrust pricing_rules table
CREATE TABLE safetrust.pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(50) NOT NULL,       -- BASE_FEE | PERCENTAGE_FEE | GAS_FEE | PLATFORM_FEE
  token VARCHAR(10) NOT NULL,           -- e.g., USDC, XLM, BTC
  base_amount DECIMAL(20,7) DEFAULT 0,
  percentage DECIMAL(5,4) DEFAULT 0,    -- 0.025 = 2.5%
  min_amount DECIMAL(20,7) DEFAULT 0,
  max_amount DECIMAL(20,7) DEFAULT 999999999,
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_safetrust_rule_type_token UNIQUE (rule_type, token)
);
