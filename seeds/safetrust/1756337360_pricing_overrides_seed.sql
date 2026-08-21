-- SafeTrust Pricing Overrides Seed Data
-- Idempotent: delete only demo seed rows by name, then re-insert.
DELETE FROM pricing_overrides
WHERE override_name IN (
    'Black Friday USDC 50% Off', 'Launch Promotion USDC', 'Holiday XLM Special',
    'Premium USDC Discount', 'Premium XLM Discount', 'Enterprise USDC Rate',
    'Enterprise XLM Rate', 'VIP USDC Exclusive',
    'High Value USDC Discount', 'Large XLM Transaction',
    'Micro USDC Fixed Fee', 'Small XLM Fixed Fee',
    'Beta Tester Reward', 'Early Adopter XLM',
    'New Year USDC Promo', 'Spring Launch XLM',
    'Test Group Premium A', 'Test Group Premium B',
    'Weekend USDC Boost', 'Weekend XLM Special',
    'Enterprise Platform Fee', 'VIP Platform Waiver',
    'Enterprise High Volume', 'VIP Bulk Discount',
    'Summer 2024 Expired'
);

-- Promotional Campaigns
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('Black Friday USDC 50% Off', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0125, '2024-11-29 00:00:00', '2024-12-02 23:59:59', 10, true),
('Launch Promotion USDC', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0150, NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days', 15, true),
('Holiday XLM Special', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0100, '2024-12-15 00:00:00', '2025-01-05 23:59:59', 12, true)
ON CONFLICT (override_name) DO NOTHING;

-- User Tier Pricing
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, user_tier, priority, is_active) VALUES
('Premium USDC Discount', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0200, 'PREMIUM', 30, true),
('Premium XLM Discount', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0160, 'PREMIUM', 30, true),
('Enterprise USDC Rate', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0150, 'ENTERPRISE', 20, true),
('Enterprise XLM Rate', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0120, 'ENTERPRISE', 20, true),
('VIP USDC Exclusive', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0100, 'VIP', 10, true)
ON CONFLICT (override_name) DO NOTHING;

-- Transaction Amount Based
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, min_transaction_amount, priority, is_active) VALUES
('High Value USDC Discount', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0175, 10000.00, 25, true),
('Large XLM Transaction', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0150, 5000.00, 25, true)
ON CONFLICT (override_name) DO NOTHING;

INSERT INTO pricing_overrides (override_name, base_rule_id, override_base_amount, max_transaction_amount, priority, is_active) VALUES
('Micro USDC Fixed Fee', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.25, 100.00, 35, true),
('Small XLM Fixed Fee', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.15, 50.00, 35, true)
ON CONFLICT (override_name) DO NOTHING;

-- Targeted User Promotions
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, user_id_list, priority, is_active) VALUES
('Beta Tester Reward', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0125, ARRAY['user_001', 'user_002', 'user_003'], 15, true),
('Early Adopter XLM', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0100, ARRAY['user_004', 'user_005'], 15, true)
ON CONFLICT (override_name) DO NOTHING;

-- Seasonal Campaigns
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('New Year USDC Promo', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0180, '2025-01-01 00:00:00', '2025-01-31 23:59:59', 18, true),
('Spring Launch XLM', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0140, '2025-03-01 00:00:00', '2025-03-31 23:59:59', 18, true)
ON CONFLICT (override_name) DO NOTHING;

-- A/B Testing Scenarios
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, user_tier, priority, is_active) VALUES
('Test Group Premium A', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0175, 'PREMIUM_TEST_A', 25, true),
('Test Group Premium B', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0225, 'PREMIUM_TEST_B', 25, true)
ON CONFLICT (override_name) DO NOTHING;

-- Weekend Promotions
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('Weekend USDC Boost', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0200, '2024-12-21 00:00:00', '2024-12-22 23:59:59', 20, true),
('Weekend XLM Special', (SELECT id FROM pricing_rules WHERE rule_name = 'XLM Service Fee' LIMIT 1), 0.0150, '2024-12-21 00:00:00', '2024-12-22 23:59:59', 20, true)
ON CONFLICT (override_name) DO NOTHING;

-- Platform Fee Overrides
INSERT INTO pricing_overrides (override_name, base_rule_id, override_base_amount, user_tier, priority, is_active) VALUES
('Enterprise Platform Fee', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.50, 'ENTERPRISE', 20, true),
('VIP Platform Waiver', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.00, 'VIP', 10, true)
ON CONFLICT (override_name) DO NOTHING;

-- High Volume Discounts
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, min_transaction_amount, user_tier, priority, is_active) VALUES
('Enterprise High Volume', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0100, 50000.00, 'ENTERPRISE', 15, true),
('VIP Bulk Discount', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0075, 25000.00, 'VIP', 12, true)
ON CONFLICT (override_name) DO NOTHING;

-- Expired Override (for testing)
INSERT INTO pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('Summer 2024 Expired', (SELECT id FROM pricing_rules WHERE rule_name = 'USDC Standard Fee' LIMIT 1), 0.0150, '2024-06-01 00:00:00', '2024-08-31 23:59:59', 20, false)
ON CONFLICT (override_name) DO NOTHING;