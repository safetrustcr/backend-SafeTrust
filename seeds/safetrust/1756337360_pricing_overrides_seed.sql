-- SafeTrust Pricing Overrides Seed Data
-- INSERT statements for comprehensive override scenarios

-- Promotional Campaigns
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('Black Friday USDC 50% Off', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0125, '2024-11-29 00:00:00', '2024-12-02 23:59:59', 10, true),
('Launch Promotion USDC', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0150, NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days', 15, true),
('Holiday XLM Special', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0100, '2024-12-15 00:00:00', '2025-01-05 23:59:59', 12, true);

-- User Tier Pricing
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, user_tier, priority, is_active) VALUES
('Premium USDC Discount', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0200, 'PREMIUM', 30, true),
('Premium XLM Discount', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0160, 'PREMIUM', 30, true),
('Enterprise USDC Rate', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0150, 'ENTERPRISE', 20, true),
('Enterprise XLM Rate', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0120, 'ENTERPRISE', 20, true),
('VIP USDC Exclusive', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0100, 'VIP', 10, true);

-- Transaction Amount Based
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, min_transaction_amount, priority, is_active) VALUES
('High Value USDC Discount', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0175, 10000.00, 25, true),
('Large XLM Transaction', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0150, 5000.00, 25, true);

INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_base_amount, max_transaction_amount, priority, is_active) VALUES
('Micro USDC Fixed Fee', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.25, 100.00, 35, true),
('Small XLM Fixed Fee', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.15, 50.00, 35, true);

-- Targeted User Promotions
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, user_id_list, priority, is_active) VALUES
('Beta Tester Reward', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0125, ARRAY['user_001', 'user_002', 'user_003'], 15, true),
('Early Adopter XLM', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0100, ARRAY['user_004', 'user_005'], 15, true);

-- Seasonal Campaigns
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('New Year USDC Promo', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0180, '2025-01-01 00:00:00', '2025-01-31 23:59:59', 18, true),
('Spring Launch XLM', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0140, '2025-03-01 00:00:00', '2025-03-31 23:59:59', 18, true);

-- A/B Testing Scenarios
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, user_tier, priority, is_active) VALUES
('Test Group Premium A', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0175, 'PREMIUM_TEST_A', 25, true),
('Test Group Premium B', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0225, 'PREMIUM_TEST_B', 25, true);

-- Weekend Promotions
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('Weekend USDC Boost', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0200, '2024-12-21 00:00:00', '2024-12-22 23:59:59', 20, true),
('Weekend XLM Special', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_xlm' LIMIT 1), 0.0150, '2024-12-21 00:00:00', '2024-12-22 23:59:59', 20, true);

-- Platform Fee Overrides
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_base_amount, user_tier, priority, is_active) VALUES
('Enterprise Platform Fee', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.50, 'ENTERPRISE', 20, true),
('VIP Platform Waiver', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.00, 'VIP', 10, true);

-- High Volume Discounts
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, min_transaction_amount, user_tier, priority, is_active) VALUES
('Enterprise High Volume', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0100, 50000.00, 'ENTERPRISE', 15, true),
('VIP Bulk Discount', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0075, 25000.00, 'VIP', 12, true);

-- Expired Override (for testing)
INSERT INTO public.pricing_overrides (override_name, base_rule_id, override_percentage, effective_from, effective_until, priority, is_active) VALUES
('Summer 2024 Expired', (SELECT id FROM shared.pricing_rules WHERE rule_name = 'platform_fee_usdc' LIMIT 1), 0.0150, '2024-06-01 00:00:00', '2024-08-31 23:59:59', 20, false);
