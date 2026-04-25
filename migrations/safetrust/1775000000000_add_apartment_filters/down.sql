DROP INDEX IF EXISTS public.idx_apartments_description_trgm;
DROP INDEX IF EXISTS public.idx_apartments_name_trgm;
DROP INDEX IF EXISTS public.idx_apartments_category;
DROP INDEX IF EXISTS public.idx_apartments_pet_friendly;
DROP INDEX IF EXISTS public.idx_apartments_bedrooms;

ALTER TABLE public.apartments 
DROP COLUMN IF EXISTS category,
DROP COLUMN IF EXISTS pet_friendly,
DROP COLUMN IF EXISTS bedrooms;
