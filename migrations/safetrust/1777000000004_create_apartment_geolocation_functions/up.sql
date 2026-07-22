-- up.sql
CREATE OR REPLACE FUNCTION public.get_approximate_coordinates(
  lat FLOAT,
  lng FLOAT,
  precision_meters INTEGER DEFAULT 500
)
RETURNS POINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT point(
    ROUND(
      lng /
      (precision_meters::double precision * (1.0 / (111320.0 * cos(radians(lat)))))
    ) * (precision_meters::double precision * (1.0 / (111320.0 * cos(radians(lat))))) ,
    ROUND(
      lat /
      (precision_meters::double precision * (1.0 / 111320.0))
    ) * (precision_meters::double precision * (1.0 / 111320.0))
  );
$$;

CREATE OR REPLACE FUNCTION public.get_apartments_in_bounds(
  min_lat FLOAT,
  max_lat FLOAT,
  min_lng FLOAT,
  max_lng FLOAT
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
    AND a.coordinates <@ BOX(
      POINT(LEAST(min_lng, max_lng), LEAST(min_lat, max_lat)),
      POINT(GREATEST(min_lng, max_lng), GREATEST(min_lat, max_lat))
    )
  ORDER BY a.updated_at DESC;
$$;

CREATE INDEX IF NOT EXISTS idx_apartments_coordinates_available
  ON public.apartments USING GIST (coordinates)
  WHERE is_available = true AND deleted_at IS NULL;
