CREATE OR REPLACE FUNCTION safetrust.search_apartments(
  search_query      TEXT    DEFAULT NULL,
  city_filter       TEXT    DEFAULT NULL,
  min_price         NUMERIC DEFAULT NULL,
  max_price         NUMERIC DEFAULT NULL,
  bedrooms_filter   INTEGER DEFAULT NULL,
  capacity_filter   INTEGER DEFAULT NULL,
  pet_filter        BOOLEAN DEFAULT NULL,
  furnished_filter  BOOLEAN DEFAULT NULL,
  limit_input       INTEGER DEFAULT 20,
  offset_input      INTEGER DEFAULT 0
)
RETURNS SETOF safetrust.apartments
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.apartments
  WHERE
    deleted_at IS NULL
    AND is_available = true
    AND (
      search_query IS NULL
      OR name ILIKE '%' || search_query || '%'
      OR description ILIKE '%' || search_query || '%'
    )
    AND (
      city_filter IS NULL
      OR address->>'city' ILIKE '%' || city_filter || '%'
      OR address->>'neighborhood' ILIKE '%' || city_filter || '%'
    )
    AND (min_price IS NULL OR price >= min_price)
    AND (max_price IS NULL OR price <= max_price)
    AND (bedrooms_filter IS NULL OR bedrooms = bedrooms_filter)
    AND (capacity_filter IS NULL OR max_guests >= capacity_filter)
    AND (pet_filter IS NULL OR pet_friendly = pet_filter)
    AND (furnished_filter IS NULL OR furnished = furnished_filter)
  ORDER BY is_available DESC, created_at DESC
  LIMIT limit_input
  OFFSET offset_input;
$$;
