-- up.sql
CREATE OR REPLACE FUNCTION public.search_apartments(
  search_query    TEXT    DEFAULT NULL,   -- ILIKE against name + description
  city_filter     TEXT    DEFAULT NULL,   -- ILIKE against address->>'city'
  min_price       NUMERIC DEFAULT NULL,
  max_price       NUMERIC DEFAULT NULL,
  bedrooms_filter INTEGER DEFAULT NULL,
  capacity_filter INTEGER DEFAULT NULL,   -- requires Issue 1 (capacity column)
  pet_filter      BOOLEAN DEFAULT NULL,
  furnished_filter BOOLEAN DEFAULT NULL,  -- requires Issue 1 (furnished column)
  limit_input     INTEGER DEFAULT 20,
  offset_input    INTEGER DEFAULT 0
)
RETURNS SETOF public.apartments
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.apartments
  WHERE
    deleted_at IS NULL
    AND is_available = true
    -- Free-text search via trigram (uses gin_trgm indexes)
    AND (
      search_query IS NULL
      OR name ILIKE '%' || search_query || '%'
      OR description ILIKE '%' || search_query || '%'
    )
    -- City filter via JSONB address field
    AND (
      city_filter IS NULL
      OR address->>'city' ILIKE '%' || city_filter || '%'
      OR address->>'neighborhood' ILIKE '%' || city_filter || '%'
    )
    -- Price range
    AND (min_price IS NULL OR price >= min_price)
    AND (max_price IS NULL OR price <= max_price)
    -- Bedroom count
    AND (bedrooms_filter IS NULL OR bedrooms = bedrooms_filter)
    -- Capacity (max_guests >= requested capacity)
    AND (capacity_filter IS NULL OR max_guests >= capacity_filter)
    -- Pet friendly
    AND (pet_filter IS NULL OR pet_friendly = pet_filter)
    -- Furnished
    AND (furnished_filter IS NULL OR furnished = furnished_filter)
  ORDER BY
    -- Promoted/available first, then by recency
    is_available DESC,
    created_at DESC
  LIMIT limit_input
  OFFSET offset_input;
$$;
