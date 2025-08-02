CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sample room types seed data
INSERT INTO room_types (
    name, 
    description,
    created_at,
    updated_at
) VALUES
-- Standard Categories (including ones referenced by existing room seed)
('Standard', 'Comfortable room with essential amenities including private bathroom, air conditioning, and basic furnishings. Perfect for budget-conscious travelers.', NOW(), NOW()),
('Deluxe', 'Spacious room featuring premium amenities, upgraded furnishings, and enhanced comfort. Includes work area and superior bathroom facilities.', NOW(), NOW()),
('Superior', 'Well-appointed room with additional space and upgraded amenities. Features modern decor, premium linens, and enhanced guest services.', NOW(), NOW()),

-- Premium Categories  
('Junior Suite', 'Larger accommodation with separate seating area, premium amenities, and enhanced comfort features. Ideal for extended stays or business travelers.', NOW(), NOW()),
('Suite', 'Luxurious multi-room accommodation with separate living area, bedroom, and premium amenities. Perfect for special occasions or VIP guests.', NOW(), NOW()),
('Executive Suite', 'Premium suite with executive-level amenities, dedicated work space, and exclusive services. Designed for business executives and discerning travelers.', NOW(), NOW()),

-- Luxury Categories
('Presidential Suite', 'Ultimate luxury accommodation featuring multiple rooms, premium amenities, personalized service, and exclusive privileges.', NOW(), NOW()),
('Penthouse', 'Top-floor luxury accommodation with panoramic views, premium furnishings, and exclusive amenities for the most discerning guests.', NOW(), NOW()),

-- Specialty Categories
('Family Room', 'Spacious accommodation designed for families, featuring multiple beds or connecting rooms, and family-friendly amenities.', NOW(), NOW()),
('Accessible Room', 'Specially designed room meeting accessibility standards with barrier-free access, accessible bathroom, and mobility-friendly features.', NOW(), NOW()),
('Business Room', 'Professional accommodation optimized for business travelers with enhanced work space, high-speed internet, and business amenities.', NOW(), NOW()),
('Extended Stay', 'Long-term accommodation featuring kitchenette facilities, additional storage, and amenities designed for extended visits.', NOW(), NOW()); 