-- Hotel Industry Pricing Rules Seed Data

-- Room Deposit Rules (20-30% of room value)
INSERT INTO hotel_industry.pricing_rules (
  rule_name, rule_type, currency,
  base_amount, percentage, min_amount, max_amount,
  room_type, season, priority, is_active
) VALUES
  ('Standard Room Deposit',     'ROOM_DEPOSIT', 'USD', 0.0, 0.2000,  50.00,   300.00,  'STANDARD',     NULL, 100, true),
  ('Deluxe Room Deposit',       'ROOM_DEPOSIT', 'USD', 0.0, 0.2000,  80.00,   500.00,  'DELUXE',       NULL, 100, true),
  ('Suite Room Deposit',        'ROOM_DEPOSIT', 'USD', 0.0, 0.2500,  150.00,  800.00,  'SUITE',        NULL, 100, true),
  ('Presidential Suite Deposit','ROOM_DEPOSIT', 'USD', 0.0, 0.3000,  300.00,  1500.00, 'PRESIDENTIAL', NULL, 100, true)
ON CONFLICT DO NOTHING;

-- Booking Fee Rules
INSERT INTO hotel_industry.pricing_rules (
  rule_name, rule_type, currency,
  base_amount, percentage, min_amount, max_amount,
  room_type, season, priority, is_active
) VALUES
  ('Standard Booking Fee',     'BOOKING_FEE', 'USD', 10.00, 0.0,    10.00, 10.00,  NULL, NULL, 90, true),
  ('Percentage Booking Fee',   'BOOKING_FEE', 'USD', 0.0,   0.0500, 5.00,  50.00,  NULL, NULL, 85, true),
  ('USDC Booking Fee',         'BOOKING_FEE', 'USDC',0.0,   0.0300, 3.00,  30.00,  NULL, NULL, 88, true)
ON CONFLICT DO NOTHING;

-- Cancellation Fee Rules
INSERT INTO hotel_industry.pricing_rules (
  rule_name, rule_type, currency,
  base_amount, percentage, min_amount, max_amount,
  room_type, season, priority, is_active
) VALUES
  ('Late Cancellation Fee',    'CANCELLATION_FEE', 'USD', 0.0, 0.5000, 50.00,  500.00, NULL, NULL, 100, true),
  ('Early Cancellation Fee',   'CANCELLATION_FEE', 'USD', 0.0, 0.1000, 10.00,  100.00, NULL, NULL, 95,  true),
  ('No-Show Fee',              'CANCELLATION_FEE', 'USD', 0.0, 1.0000, 100.00, 1000.00,NULL, NULL, 100, true)
ON CONFLICT DO NOTHING;

-- Service Fee Rules
INSERT INTO hotel_industry.pricing_rules (
  rule_name, rule_type, currency,
  base_amount, percentage, min_amount, max_amount,
  room_type, season, priority, is_active
) VALUES
  ('Standard Service Fee',     'SERVICE_FEE', 'USD',  0.0, 0.1000, 5.00,  100.00, NULL, NULL, 80, true),
  ('Premium Service Fee',      'SERVICE_FEE', 'USD',  0.0, 0.1500, 10.00, 150.00, NULL, NULL, 75, true),
  ('USDC Service Fee',         'SERVICE_FEE', 'USDC', 0.0, 0.0800, 4.00,  80.00,  NULL, NULL, 82, true)
ON CONFLICT DO NOTHING;

-- Seasonal Rate Rules
INSERT INTO hotel_industry.pricing_rules (
  rule_name, rule_type, currency,
  base_amount, percentage, min_amount, max_amount,
  room_type, season, priority, is_active
) VALUES
  ('High Season Surcharge',    'SEASONAL_RATE', 'USD', 0.0, 0.3000, 30.00,  300.00, NULL, 'HIGH_SEASON',  70, true),
  ('Low Season Discount',      'SEASONAL_RATE', 'USD', 0.0, 0.1500, 15.00,  150.00, NULL, 'LOW_SEASON',   70, true),
  ('Peak Season Surcharge',    'SEASONAL_RATE', 'USD', 0.0, 0.5000, 50.00,  500.00, NULL, 'PEAK',         65, true),
  ('Off Peak Discount',        'SEASONAL_RATE', 'USD', 0.0, 0.2000, 20.00,  200.00, NULL, 'OFF_PEAK',     65, true)
ON CONFLICT DO NOTHING;

-- Early Booking Discount Rules
INSERT INTO hotel_industry.pricing_rules (
  rule_name, rule_type, currency,
  base_amount, percentage, min_amount, max_amount,
  room_type, season, advance_booking_days, priority, is_active
) VALUES
  ('30-Day Advance Discount',  'BOOKING_FEE', 'USD', 0.0, 0.0500, 0.00, 50.00, NULL, NULL, 30, 60, true),
  ('60-Day Advance Discount',  'BOOKING_FEE', 'USD', 0.0, 0.1000, 0.00, 100.00,NULL, NULL, 60, 55, true),
  ('90-Day Advance Discount',  'BOOKING_FEE', 'USD', 0.0, 0.1500, 0.00, 150.00,NULL, NULL, 90, 50, true)
ON CONFLICT DO NOTHING;