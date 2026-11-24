WITH seed_rules (
  rule_name,
  rule_type,
  currency,
  base_amount,
  percentage,
  min_amount,
  max_amount,
  room_type,
  season,
  advance_booking_days,
  priority,
  is_active
) AS (
  VALUES
    ('Standard Room Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.2000, 50.00, 300.00, 'STANDARD', NULL, NULL, 100, true),
    ('Deluxe Room Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.2000, 80.00, 500.00, 'DELUXE', NULL, NULL, 100, true),
    ('Suite Room Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.2500, 150.00, 800.00, 'SUITE', NULL, NULL, 100, true),
    ('Presidential Suite Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.3000, 300.00, 1500.00, 'PRESIDENTIAL', NULL, NULL, 100, true),
    ('Standard Booking Fee', 'BOOKING_FEE', 'USD', 10.00, 0.0, 10.00, 10.00, NULL, NULL, NULL, 90, true),
    ('Percentage Booking Fee', 'BOOKING_FEE', 'USD', 0.0, 0.0500, 5.00, 50.00, NULL, NULL, NULL, 85, true),
    ('USDC Booking Fee', 'BOOKING_FEE', 'USDC', 0.0, 0.0300, 3.00, 30.00, NULL, NULL, NULL, 88, true),
    ('Late Cancellation Fee', 'CANCELLATION_FEE', 'USD', 0.0, 0.5000, 50.00, 500.00, NULL, NULL, NULL, 100, true),
    ('Early Cancellation Fee', 'CANCELLATION_FEE', 'USD', 0.0, 0.1000, 10.00, 100.00, NULL, NULL, NULL, 95, true),
    ('No-Show Fee', 'CANCELLATION_FEE', 'USD', 0.0, 1.0000, 100.00, 1000.00, NULL, NULL, NULL, 100, true),
    ('Standard Service Fee', 'SERVICE_FEE', 'USD', 0.0, 0.1000, 5.00, 100.00, NULL, NULL, NULL, 80, true),
    ('Premium Service Fee', 'SERVICE_FEE', 'USD', 0.0, 0.1500, 10.00, 150.00, NULL, NULL, NULL, 75, true),
    ('USDC Service Fee', 'SERVICE_FEE', 'USDC', 0.0, 0.0800, 4.00, 80.00, NULL, NULL, NULL, 82, true),
    ('High Season Surcharge', 'SEASONAL_RATE', 'USD', 0.0, 0.3000, 30.00, 300.00, NULL, 'HIGH_SEASON', NULL, 70, true),
    ('Low Season Discount', 'SEASONAL_RATE', 'USD', 0.0, 0.1500, 15.00, 150.00, NULL, 'LOW_SEASON', NULL, 70, true),
    ('Peak Season Surcharge', 'SEASONAL_RATE', 'USD', 0.0, 0.5000, 50.00, 500.00, NULL, 'PEAK', NULL, 65, true),
    ('Off Peak Discount', 'SEASONAL_RATE', 'USD', 0.0, 0.2000, 20.00, 200.00, NULL, 'OFF_PEAK', NULL, 65, true),
    ('30-Day Advance Discount', 'BOOKING_FEE', 'USD', 0.0, 0.0500, 0.00, 50.00, NULL, NULL, 30, 60, true),
    ('60-Day Advance Discount', 'BOOKING_FEE', 'USD', 0.0, 0.1000, 0.00, 100.00, NULL, NULL, 60, 55, true),
    ('90-Day Advance Discount', 'BOOKING_FEE', 'USD', 0.0, 0.1500, 0.00, 150.00, NULL, NULL, 90, 50, true)
)
INSERT INTO hotel_industry.pricing_rules (
  hotel_id,
  room_type_id,
  rule_name,
  rule_type,
  currency,
  base_amount,
  percentage,
  min_amount,
  max_amount,
  season,
  advance_booking_days,
  priority,
  is_active
)
SELECT
  hotel.id,
  room_type.id,
  seed.rule_name,
  seed.rule_type,
  seed.currency,
  seed.base_amount,
  seed.percentage,
  seed.min_amount,
  seed.max_amount,
  seed.season,
  seed.advance_booking_days,
  seed.priority,
  seed.is_active
FROM hotel_industry.hotels hotel
CROSS JOIN seed_rules seed
LEFT JOIN hotel_industry.room_types room_type
  ON UPPER(room_type.name) = seed.room_type
ON CONFLICT DO NOTHING;
