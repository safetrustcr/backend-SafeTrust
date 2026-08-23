CREATE SCHEMA IF NOT EXISTS hotel_industry;

CREATE TABLE IF NOT EXISTS hotel_industry.pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    base_amount DECIMAL(20,7) DEFAULT 0,
    percentage DECIMAL(5,4) DEFAULT 0,
    min_amount DECIMAL(20,7) DEFAULT 0,
    max_amount DECIMAL(20,7) DEFAULT 999999999,
    room_type VARCHAR(50),
    season VARCHAR(30),
    advance_booking_days INTEGER,
    priority INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_hotel_rule_type_currency UNIQUE (rule_type, currency, room_type, season),
    CONSTRAINT unique_hotel_rule_name UNIQUE (rule_name)
);

CREATE INDEX IF NOT EXISTS idx_hotel_pricing_rules_type_currency_active
    ON hotel_industry.pricing_rules(rule_type, currency, is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_hotel_pricing_rules_room_season
    ON hotel_industry.pricing_rules(room_type, season, is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_hotel_pricing_rules_priority
    ON hotel_industry.pricing_rules(priority, is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_hotel_pricing_rules_advance_booking
    ON hotel_industry.pricing_rules(advance_booking_days, is_active)
    WHERE is_active = true AND advance_booking_days IS NOT NULL;

-- Use the schema-qualified function defined in 1723171122097
CREATE TRIGGER update_hotel_pricing_rules_updated_at
    BEFORE UPDATE ON hotel_industry.pricing_rules
    FOR EACH ROW EXECUTE FUNCTION hotel_industry.update_updated_at_column();

COMMENT ON TABLE hotel_industry.pricing_rules IS
'Pricing rules for Hotel Industry tenant - supports room deposits, booking fees, seasonal rates';