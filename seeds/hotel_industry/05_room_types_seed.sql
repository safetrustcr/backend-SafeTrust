CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.room_types (name, description, created_at, updated_at)
VALUES
  ('Standard',         'Comfortable room with essential amenities including private bathroom, air conditioning, and basic furnishings.', NOW(), NOW()),
  ('Deluxe',           'Spacious room featuring premium amenities, upgraded furnishings, and enhanced comfort.', NOW(), NOW()),
  ('Superior',         'Well-appointed room with additional space and upgraded amenities.', NOW(), NOW()),
  ('Junior Suite',     'Larger accommodation with separate seating area and premium amenities.', NOW(), NOW()),
  ('Suite',            'Luxurious multi-room accommodation with separate living area and bedroom.', NOW(), NOW()),
  ('Executive Suite',  'Premium suite with executive-level amenities and dedicated work space.', NOW(), NOW()),
  ('Presidential Suite','Ultimate luxury accommodation featuring multiple rooms and exclusive privileges.', NOW(), NOW()),
  ('Penthouse',        'Top-floor luxury accommodation with panoramic views and premium furnishings.', NOW(), NOW()),
  ('Family Room',      'Spacious accommodation designed for families with multiple beds.', NOW(), NOW()),
  ('Accessible Room',  'Specially designed room meeting accessibility standards.', NOW(), NOW()),
  ('Business Room',    'Professional accommodation optimized for business travelers.', NOW(), NOW()),
  ('Extended Stay',    'Long-term accommodation featuring kitchenette facilities.', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;