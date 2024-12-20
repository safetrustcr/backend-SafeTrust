-- Ensure UUID extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Insert 3 images for "Modern Loft in Heredia"
INSERT INTO apartment_images (id, apartment_id, image_url, uploaded_at)
VALUES
(uuid_generate_v4(), 
 (SELECT id FROM apartments WHERE name = 'Modern Loft in Heredia'), 
 'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-1.jpg', 
 NOW()),
(uuid_generate_v4(), 
 (SELECT id FROM apartments WHERE name = 'Modern Loft in Heredia'), 
 'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-10-810x540.jpg', 
 NOW()),
(uuid_generate_v4(), 
 (SELECT id FROM apartments WHERE name = 'Modern Loft in Heredia'), 
 'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-9-810x531.jpg', 
 NOW());

-- Insert 3 images for "Modern Loft in San Jose"
INSERT INTO apartment_images (id, apartment_id, image_url, uploaded_at)
VALUES
(uuid_generate_v4(), 
 (SELECT id FROM apartments WHERE name = 'Modern Loft in San Jose'), 
 'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-22-810x540.jpg', 
 NOW()),
(uuid_generate_v4(), 
 (SELECT id FROM apartments WHERE name = 'Modern Loft in San Jose'), 
 'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-18-810x540.jpg', 
 NOW()),
(uuid_generate_v4(), 
 (SELECT id FROM apartments WHERE name = 'Modern Loft in San Jose'), 
 'https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-21-810x540.jpg', 
 NOW());
