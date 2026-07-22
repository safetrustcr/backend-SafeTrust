DROP INDEX IF EXISTS public.idx_apartments_furnished;
DROP INDEX IF EXISTS public.idx_apartments_bathrooms;
DROP INDEX IF EXISTS public.idx_apartments_capacity;

ALTER TABLE public.apartments
  DROP CONSTRAINT IF EXISTS valid_max_guests,
  DROP CONSTRAINT IF EXISTS valid_capacity,
  DROP CONSTRAINT IF EXISTS valid_bathrooms;

ALTER TABLE public.apartments
  DROP COLUMN IF EXISTS furnished,
  DROP COLUMN IF EXISTS floor_area,
  DROP COLUMN IF EXISTS max_guests,
  DROP COLUMN IF EXISTS capacity,
  DROP COLUMN IF EXISTS bathrooms;
