INSERT INTO shared.pricing_rules (
  rule_name,
  rule_type,
  token,
  base_amount,
  percentage,
  min_amount,
  max_amount
) VALUES
  -- TrustlessWork base fees
  ('trustlesswork_base_fee_usdc', 'BASE_FEE', 'USDC', 1.00, 0, 0, 999999999),
  ('trustlesswork_base_fee_xlm', 'BASE_FEE', 'XLM', 5.00, 0, 0, 999999999),

  -- Platform percentage fees
  ('platform_fee_usdc', 'PERCENTAGE_FEE', 'USDC', 0, 0.025, 0.50, 100), -- 2.5%, min $0.50, max $100
  ('platform_fee_xlm',  'PERCENTAGE_FEE', 'XLM',  0, 0.025, 2.50, 500), -- 2.5%, min 2.5 XLM, max 500 XLM

  -- Gas fees (estimated)
  ('stellar_gas_fee', 'GAS_FEE', 'XLM', 0.0001, 0, 0.0001, 1.0);
