CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.apartments 
ADD COLUMN IF NOT EXISTS bedrooms INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS pet_friendly BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Apartment';

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_apartments_bedrooms ON public.apartments(bedrooms);
CREATE INDEX IF NOT EXISTS idx_apartments_pet_friendly ON public.apartments(pet_friendly);
CREATE INDEX IF NOT EXISTS idx_apartments_category ON public.apartments(category);

-- Trigram indexes for ILIKE search performance
CREATE INDEX IF NOT EXISTS idx_apartments_name_trgm ON public.apartments USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_apartments_description_trgm ON public.apartments USING gin (description gin_trgm_ops);
