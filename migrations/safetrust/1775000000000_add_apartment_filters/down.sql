DROP INDEX IF EXISTS idx_apartments_category;
DROP INDEX IF EXISTS idx_apartments_pet_friendly;
DROP INDEX IF EXISTS idx_apartments_bedrooms;

ALTER TABLE apartments 
DROP COLUMN IF EXISTS category,
DROP COLUMN IF EXISTS pet_friendly,
DROP COLUMN IF EXISTS bedrooms;
