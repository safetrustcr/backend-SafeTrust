CREATE OR REPLACE FUNCTION public.find_nearby_apartments(
  lat FLOAT,
  lng FLOAT,
  radius_meters FLOAT DEFAULT 5000
)
RETURNS SETOF public.apartments
LANGUAGE sql
STABLE
AS $$
  SELECT a.*
  FROM public.apartments a
  WHERE
    a.deleted_at IS NULL
    AND a.is_available = true
    AND a.location_area IS NOT NULL
    AND ST_DWithin(
      a.location_area::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      LEAST(radius_meters, 50000)
    )
  ORDER BY
    a.location_area::geography <-> ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography ASC;
$$;
