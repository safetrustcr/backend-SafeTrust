

-- Clear existing seed data (development only!)
TRUNCATE safetrust.pricing_rules RESTART IDENTITY CASCADE;

-- USDC Pricing Rules
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('USDC Standard Fee', 'PERCENTAGE_FEE', 'USDC', 0.0, 0.0250, 0.50, 25.00, 100),
('USDC Large Transaction', 'PERCENTAGE_FEE', 'USDC', 0.0, 0.0150, 5.00, 100.00, 90),
('USDC Minimum Fee', 'BASE_FEE', 'USDC', 0.50, 0.0, 0.50, 0.50, 110);

-- XLM (Stellar) Pricing Rules  
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('XLM Network Fee', 'BASE_FEE', 'XLM', 0.10, 0.0, 0.10, 1.00, 100),
('XLM Service Fee', 'PERCENTAGE_FEE', 'XLM', 0.0, 0.0200, 0.20, 10.00, 105),
('XLM Express Processing', 'BASE_FEE', 'XLM', 2.00, 0.0, 2.00, 2.00, 80);

-- Bitcoin Pricing Rules
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('BTC Standard Fee', 'PERCENTAGE_FEE', 'BTC', 0.0, 0.0300, 0.0001, 0.0050, 100),
('BTC High Value Transaction', 'PERCENTAGE_FEE', 'BTC', 0.0, 0.0200, 0.0010, 0.0100, 90),
('BTC Network Fee', 'BASE_FEE', 'BTC', 0.0002, 0.0, 0.0002, 0.0020, 110);

-- Ethereum Pricing Rules
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('ETH Gas Fee', 'GAS_FEE', 'ETH', 0.0050, 0.0, 0.0020, 0.0200, 100),
('ETH Service Fee', 'PERCENTAGE_FEE', 'ETH', 0.0, 0.0250, 0.0010, 0.0500, 105),
('ETH Priority Processing', 'BASE_FEE', 'ETH', 0.0100, 0.0, 0.0100, 0.0100, 85);

-- Platform-wide fees (ANY token)
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('SafeTrust Platform Fee', 'PLATFORM_FEE', 'ANY', 1.00, 0.0, 0.25, 10.00, 200),
('Escrow Service Fee', 'BASE_FEE', 'ANY', 0.50, 0.0, 0.50, 5.00, 195),
('Trust Verification Fee', 'PERCENTAGE_FEE', 'ANY', 0.0, 0.0100, 0.10, 2.00, 190);

-- Special promotional rules
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('USDC Early Adopter Discount', 'PERCENTAGE_FEE', 'USDC', 0.0, 0.0150, 0.25, 15.00, 50),
('XLM Launch Promotion', 'PERCENTAGE_FEE', 'XLM', 0.0, 0.0100, 0.10, 5.00, 45);

-- Volume-based pricing (future scenarios)
INSERT INTO safetrust.pricing_rules 
(rule_name, rule_type, token, base_amount, percentage, min_amount, max_amount, priority) VALUES
('High Volume USDC', 'PERCENTAGE_FEE', 'USDC', 0.0, 0.0100, 1.00, 50.00, 60),
('Enterprise XLM Rate', 'PERCENTAGE_FEE', 'XLM', 0.0, 0.0075, 0.50, 25.00, 55);

-- Update timestamps randomly (demo realism)
UPDATE safetrust.pricing_rules SET 
    created_at = NOW() - (random() * interval '30 days'),
    updated_at = NOW() - (random() * interval '7 days');
