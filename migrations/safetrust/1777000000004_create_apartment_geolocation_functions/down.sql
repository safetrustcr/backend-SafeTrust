DROP INDEX IF EXISTS public.idx_apartments_coordinates_available;
DROP FUNCTION IF EXISTS public.get_apartments_in_bounds(FLOAT, FLOAT, FLOAT, FLOAT);
DROP FUNCTION IF EXISTS public.get_approximate_coordinates(FLOAT, FLOAT, INTEGER);
