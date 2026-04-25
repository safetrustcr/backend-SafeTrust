ALTER TABLE apartments 
ADD COLUMN IF NOT EXISTS bedrooms INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS pet_friendly BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Apartment';

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_apartments_bedrooms ON apartments(bedrooms);
CREATE INDEX IF NOT EXISTS idx_apartments_pet_friendly ON apartments(pet_friendly);
CREATE INDEX IF NOT EXISTS idx_apartments_category ON apartments(category);
