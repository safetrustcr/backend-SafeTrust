-- Create Hotel Industry schema if not exists
CREATE SCHEMA IF NOT EXISTS hotel_industry;

-- Create Hotel Industry pricing rules table
CREATE TABLE hotel_industry.pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,        -- 'ROOM_DEPOSIT', 'BOOKING_FEE', 'CANCELLATION_FEE', 'SERVICE_FEE', 'SEASONAL_RATE'
    currency VARCHAR(10) NOT NULL,         -- 'USD', 'EUR', 'USDC', etc.
    
    -- Pricing configuration
    base_amount DECIMAL(20,7) DEFAULT 0,   -- Fixed fee amount
    percentage DECIMAL(5,4) DEFAULT 0,     -- Percentage fee (e.g., 0.050 = 5%)
    min_amount DECIMAL(20,7) DEFAULT 0,    -- Minimum fee amount
    max_amount DECIMAL(20,7) DEFAULT 999999999, -- Maximum fee amount
    
    -- Hotel-specific fields
    room_type VARCHAR(50),                 -- 'STANDARD', 'DELUXE', 'SUITE', 'PRESIDENTIAL'
    season VARCHAR(30),                    -- 'HIGH_SEASON', 'LOW_SEASON', 'PEAK', 'OFF_PEAK'
    advance_booking_days INTEGER,          -- Days in advance for early booking discounts
    
    -- Rule management
    priority INTEGER DEFAULT 100,          -- Lower number = higher priority
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique rule per type/currency combination
    CONSTRAINT unique_hotel_rule_type_currency UNIQUE (rule_type, currency, room_type, season)
);

-- Performance indexes for common query patterns
CREATE INDEX idx_hotel_pricing_rules_type_currency_active 
ON hotel_industry.pricing_rules(rule_type, currency, is_active)
WHERE is_active = true;

CREATE INDEX idx_hotel_pricing_rules_room_season 
ON hotel_industry.pricing_rules(room_type, season, is_active)
WHERE is_active = true;

CREATE INDEX idx_hotel_pricing_rules_priority 
ON hotel_industry.pricing_rules(priority, is_active)
WHERE is_active = true;

CREATE INDEX idx_hotel_pricing_rules_advance_booking 
ON hotel_industry.pricing_rules(advance_booking_days, is_active)
WHERE is_active = true AND advance_booking_days IS NOT NULL;

-- Auto-update timestamp trigger
CREATE TRIGGER update_hotel_pricing_rules_updated_at 
    BEFORE UPDATE ON hotel_industry.pricing_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add helpful comment
COMMENT ON TABLE hotel_industry.pricing_rules IS 
'Pricing rules for Hotel Industry tenant - supports room deposits, booking fees, seasonal rates, and hospitality-specific pricing models';