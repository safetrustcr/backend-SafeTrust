-- Hotel Industry Pricing Rules Seed Data

-- INSERT statements for comprehensive hospitality pricing scenarios

-- Room Deposit Rules (20-30% of room value)
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, room_type, priority, is_active) VALUES
('Standard Room Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.2000, 50.00, 300.00, 'STANDARD', 100, true),
('Deluxe Room Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.2000, 80.00, 500.00, 'DELUXE', 100, true),
('Suite Room Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.2500, 150.00, 800.00, 'SUITE', 100, true),
('Presidential Suite Deposit', 'ROOM_DEPOSIT', 'USD', 0.0, 0.3000, 300.00, 1500.00, 'PRESIDENTIAL', 100, true);

-- Booking Fees (Fixed amounts per room type)
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, room_type, priority, is_active) VALUES
('Standard Booking Fee', 'BOOKING_FEE', 'USD', 15.00, 0.0, 15.00, 15.00, 'STANDARD', 110, true),
('Deluxe Booking Fee', 'BOOKING_FEE', 'USD', 25.00, 0.0, 25.00, 25.00, 'DELUXE', 110, true),
('Suite Booking Fee', 'BOOKING_FEE', 'USD', 40.00, 0.0, 40.00, 40.00, 'SUITE', 110, true),
('Presidential Booking Fee', 'BOOKING_FEE', 'USD', 75.00, 0.0, 75.00, 75.00, 'PRESIDENTIAL', 110, true);

-- Seasonal Rate Adjustments
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, season, priority, is_active) VALUES
('High Season Premium', 'SEASONAL_RATE', 'USD', 0.0, 0.4000, 0.0, 999999, 'HIGH_SEASON', 90, true),
('Peak Season Premium', 'SEASONAL_RATE', 'USD', 0.0, 0.6000, 0.0, 999999, 'PEAK', 85, true),
('Low Season Discount', 'SEASONAL_RATE', 'USD', 0.0, -0.2000, 0.0, 999999, 'LOW_SEASON', 90, true),
('Off Peak Discount', 'SEASONAL_RATE', 'USD', 0.0, -0.3000, 0.0, 999999, 'OFF_PEAK', 85, true);

-- Service Fees
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, priority, is_active) VALUES
('Platform Service Fee', 'SERVICE_FEE', 'USD', 8.00, 0.0200, 8.00, 75.00, 120, true),
('Processing Fee', 'SERVICE_FEE', 'USD', 5.00, 0.0, 5.00, 5.00, 125, true),
('Resort Fee', 'SERVICE_FEE', 'USD', 25.00, 0.0, 25.00, 25.00, 115, true);

-- Crypto Payment Fees
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, priority, is_active) VALUES
('USDC Payment Fee', 'SERVICE_FEE', 'USDC', 3.00, 0.0250, 3.00, 50.00, 120, true),
('Crypto Processing Fee', 'SERVICE_FEE', 'USDC', 2.50, 0.0, 2.50, 2.50, 125, true);

-- Cancellation Fees (Based on room type)
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, room_type, priority, is_active) VALUES
('Standard Cancellation Fee', 'CANCELLATION_FEE', 'USD', 0.0, 0.1000, 25.00, 100.00, 'STANDARD', 130, true),
('Deluxe Cancellation Fee', 'CANCELLATION_FEE', 'USD', 0.0, 0.1500, 40.00, 150.00, 'DELUXE', 130, true),
('Suite Cancellation Fee', 'CANCELLATION_FEE', 'USD', 0.0, 0.2000, 75.00, 300.00, 'SUITE', 130, true),
('Presidential Cancellation Fee', 'CANCELLATION_FEE', 'USD', 0.0, 0.2500, 150.00, 500.00, 'PRESIDENTIAL', 130, true);

-- Early Booking Discounts (Based on advance booking days)
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, advance_booking_days, priority, is_active) VALUES
('Early Bird 30 Days', 'BOOKING_FEE', 'USD', 0.0, -0.1000, 0.0, 999999, 30, 80, true),
('Early Bird 60 Days', 'BOOKING_FEE', 'USD', 0.0, -0.1500, 0.0, 999999, 60, 75, true),
('Early Bird 90 Days', 'BOOKING_FEE', 'USD', 0.0, -0.2000, 0.0, 999999, 90, 70, true);

-- European Market (EUR pricing)
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, room_type, priority, is_active) VALUES
('Standard Room Deposit EUR', 'ROOM_DEPOSIT', 'EUR', 0.0, 0.2000, 45.00, 280.00, 'STANDARD', 100, true),
('Deluxe Room Deposit EUR', 'ROOM_DEPOSIT', 'EUR', 0.0, 0.2000, 75.00, 450.00, 'DELUXE', 100, true),
('European Booking Fee', 'BOOKING_FEE', 'EUR', 12.00, 0.0, 12.00, 12.00, 'STANDARD', 110, true),
('European Service Fee', 'SERVICE_FEE', 'EUR', 6.50, 0.0150, 6.50, 60.00, 120, true);

-- Premium Services
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, priority, is_active) VALUES
('Concierge Service Fee', 'SERVICE_FEE', 'USD', 15.00, 0.0, 15.00, 15.00, 135, true),
('Valet Parking Fee', 'SERVICE_FEE', 'USD', 30.00, 0.0, 30.00, 30.00, 140, true),
('Spa Package Fee', 'SERVICE_FEE', 'USD', 50.00, 0.0, 50.00, 50.00, 145, true);

-- Group Booking Discounts
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, priority, is_active) VALUES
('Group Booking Discount', 'BOOKING_FEE', 'USD', 0.0, -0.1500, 0.0, 999999, 95, true),
('Corporate Rate Discount', 'SERVICE_FEE', 'USD', 0.0, -0.1000, 0.0, 999999, 95, true);

-- Weekend and Holiday Premiums
INSERT INTO hotel_industry.pricing_rules (rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, season, priority, is_active) VALUES
('Weekend Premium', 'SEASONAL_RATE', 'USD', 0.0, 0.2500, 0.0, 999999, 'WEEKEND', 88, true),
('Holiday Premium', 'SEASONAL_RATE', 'USD', 0.0, 0.5000, 0.0, 999999, 'HOLIDAY', 82, true);
-- This seed data demonstrates hospitality-specific pricing models

-- Insert room deposit rules for different room types
INSERT INTO hotel_industry.pricing_rules (
    rule_name, rule_type, currency, base_amount, percentage, min_amount, max_amount, 
    room_type, season, advance_booking_days, priority, is_active
) VALUES
-- Room deposits by room type (USD)
('Standard Room Deposit', 'ROOM_DEPOSIT', 'USD', 50.00, 0.0000, 50.00, 100.00, 'STANDARD', NULL, NULL, 10, true),
('Deluxe Room Deposit', 'ROOM_DEPOSIT', 'USD', 100.00, 0.0000, 100.00, 200.00, 'DELUXE', NULL, NULL, 10, true),
('Suite Room Deposit', 'ROOM_DEPOSIT', 'USD', 250.00, 0.0000, 250.00, 500.00, 'SUITE', NULL, NULL, 10, true),
('Presidential Suite Deposit', 'ROOM_DEPOSIT', 'USD', 500.00, 0.0000, 500.00, 1000.00, 'PRESIDENTIAL', NULL, NULL, 10, true),

-- Room deposits in EUR
('Standard Room Deposit EUR', 'ROOM_DEPOSIT', 'EUR', 45.00, 0.0000, 45.00, 90.00, 'STANDARD', NULL, NULL, 10, true),
('Deluxe Room Deposit EUR', 'ROOM_DEPOSIT', 'EUR', 90.00, 0.0000, 90.00, 180.00, 'DELUXE', NULL, NULL, 10, true),
('Suite Room Deposit EUR', 'ROOM_DEPOSIT', 'EUR', 225.00, 0.0000, 225.00, 450.00, 'SUITE', NULL, NULL, 10, true),

-- Room deposits in USDC (crypto)
('Standard Room Deposit USDC', 'ROOM_DEPOSIT', 'USDC', 50.00, 0.0000, 50.00, 100.00, 'STANDARD', NULL, NULL, 10, true),
('Deluxe Room Deposit USDC', 'ROOM_DEPOSIT', 'USDC', 100.00, 0.0000, 100.00, 200.00, 'DELUXE', NULL, NULL, 10, true),

-- Booking fees (percentage-based)
('Online Booking Fee', 'BOOKING_FEE', 'USD', 0.00, 0.0350, 5.00, 50.00, NULL, NULL, NULL, 20, true),
('Online Booking Fee EUR', 'BOOKING_FEE', 'EUR', 0.00, 0.0350, 4.50, 45.00, NULL, NULL, NULL, 20, true),
('Crypto Booking Fee', 'BOOKING_FEE', 'USDC', 0.00, 0.0250, 2.50, 25.00, NULL, NULL, NULL, 20, true),

-- Service fees
('Resort Service Fee', 'SERVICE_FEE', 'USD', 25.00, 0.0000, 25.00, 75.00, NULL, NULL, NULL, 30, true),
('Cleaning Service Fee', 'SERVICE_FEE', 'USD', 15.00, 0.0000, 15.00, 50.00, NULL, NULL, NULL, 30, true),

-- Seasonal rate adjustments
('High Season Premium - Standard', 'SEASONAL_RATE', 'USD', 0.00, 0.2500, 20.00, 100.00, 'STANDARD', 'HIGH_SEASON', NULL, 40, true),
('High Season Premium - Deluxe', 'SEASONAL_RATE', 'USD', 0.00, 0.2500, 40.00, 150.00, 'DELUXE', 'HIGH_SEASON', NULL, 40, true),
('High Season Premium - Suite', 'SEASONAL_RATE', 'USD', 0.00, 0.3000, 75.00, 300.00, 'SUITE', 'HIGH_SEASON', NULL, 40, true),

('Peak Season Premium - Presidential', 'SEASONAL_RATE', 'USD', 0.00, 0.5000, 200.00, 800.00, 'PRESIDENTIAL', 'PEAK', NULL, 35, true),

-- Low season discounts (negative percentage for discounts)
('Low Season Discount - Standard', 'SEASONAL_RATE', 'USD', 0.00, -0.1500, -50.00, -10.00, 'STANDARD', 'LOW_SEASON', NULL, 50, true),
('Low Season Discount - Deluxe', 'SEASONAL_RATE', 'USD', 0.00, -0.1500, -75.00, -15.00, 'DELUXE', 'LOW_SEASON', NULL, 50, true),

-- Early booking discounts
('Early Bird 30 Days Discount', 'BOOKING_FEE', 'USD', 0.00, -0.0500, -25.00, -5.00, NULL, NULL, 30, 15, true),
('Early Bird 60 Days Discount', 'BOOKING_FEE', 'USD', 0.00, -0.1000, -50.00, -10.00, NULL, NULL, 60, 10, true),
('Early Bird 90 Days Discount', 'BOOKING_FEE', 'USD', 0.00, -0.1500, -75.00, -15.00, NULL, NULL, 90, 5, true),

-- Cancellation fees
('Standard Cancellation Fee', 'CANCELLATION_FEE', 'USD', 25.00, 0.1000, 25.00, 200.00, NULL, NULL, NULL, 60, true),
('Premium Cancellation Fee', 'CANCELLATION_FEE', 'USD', 50.00, 0.1500, 50.00, 400.00, 'SUITE', NULL, NULL, 60, true),
('Presidential Cancellation Fee', 'CANCELLATION_FEE', 'USD', 100.00, 0.2000, 100.00, 800.00, 'PRESIDENTIAL', NULL, NULL, 60, true),

-- Multi-currency cancellation fees
('Standard Cancellation Fee EUR', 'CANCELLATION_FEE', 'EUR', 22.50, 0.1000, 22.50, 180.00, NULL, NULL, NULL, 60, true),
('Crypto Cancellation Fee', 'CANCELLATION_FEE', 'USDC', 25.00, 0.0750, 25.00, 150.00, NULL, NULL, NULL, 60, true);

-- Add some comments for the pricing rules
COMMENT ON TABLE hotel_industry.pricing_rules IS 'Pricing rules for Hotel Industry tenant - supports room deposits, booking fees, seasonal rates, and hospitality-specific pricing models';

-- Example queries that demonstrate the pricing system:
/*
-- Get all pricing rules for a standard room in high season
SELECT * FROM hotel_industry.pricing_rules 
WHERE (room_type = 'STANDARD' OR room_type IS NULL) 
AND (season = 'HIGH_SEASON' OR season IS NULL)
AND is_active = true 
ORDER BY priority;

-- Get booking fees for different advance booking periods
SELECT * FROM hotel_industry.pricing_rules 
WHERE rule_type = 'BOOKING_FEE' 
AND advance_booking_days IS NOT NULL
AND is_active = true 
ORDER BY advance_booking_days DESC;

-- Get all deposit requirements by room type
SELECT room_type, currency, base_amount, min_amount, max_amount
FROM hotel_industry.pricing_rules 
WHERE rule_type = 'ROOM_DEPOSIT' 
AND is_active = true 
ORDER BY room_type, currency;
*/

