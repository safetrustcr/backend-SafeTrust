DO $$
DECLARE
  divergent_count BIGINT;
  duplicate_scope_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO divergent_count
  FROM (
    SELECT
      rule_name,
      rule_type,
      currency,
      room_type_id,
      season,
      advance_booking_days
    FROM hotel_industry.pricing_rules
    GROUP BY
      rule_name,
      rule_type,
      currency,
      room_type_id,
      season,
      advance_booking_days
    HAVING COUNT(DISTINCT ROW(
      base_amount,
      percentage,
      min_amount,
      max_amount,
      priority,
      is_active
    )) > 1
  ) divergent;

  IF divergent_count > 0 THEN
    RAISE EXCEPTION
      'Cannot restore global pricing rules: % rule scope(s) have hotel-specific values',
      divergent_count;
  END IF;

  WITH ranked AS (
    SELECT
      ctid,
      ROW_NUMBER() OVER (
        PARTITION BY
          rule_name,
          rule_type,
          currency,
          room_type_id,
          season,
          advance_booking_days
        ORDER BY hotel_id, id
      ) AS copy_number
    FROM hotel_industry.pricing_rules
  )
  DELETE FROM hotel_industry.pricing_rules rule
  USING ranked
  WHERE rule.ctid = ranked.ctid
    AND ranked.copy_number > 1;

  SELECT COUNT(*) INTO duplicate_scope_count
  FROM (
    SELECT rule_type, currency, room_type_id, season
    FROM hotel_industry.pricing_rules
    WHERE room_type_id IS NOT NULL
      AND season IS NOT NULL
    GROUP BY rule_type, currency, room_type_id, season
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_scope_count > 0 THEN
    RAISE EXCEPTION
      'Cannot restore the old pricing constraint: % non-NULL scope(s) now have duplicate rules',
      duplicate_scope_count;
  END IF;
END;
$$;

ALTER TABLE hotel_industry.pricing_rules
  DROP CONSTRAINT unique_hotel_pricing_rule_scope,
  DROP CONSTRAINT pricing_rules_hotel_id_fkey,
  DROP CONSTRAINT pricing_rules_room_type_id_fkey,
  ADD COLUMN room_type VARCHAR(50);

UPDATE hotel_industry.pricing_rules rule
SET room_type = room_type.name
FROM hotel_industry.room_types room_type
WHERE rule.room_type_id = room_type.id;

DROP INDEX hotel_industry.idx_hotel_pricing_rules_type_currency_active;
CREATE INDEX idx_hotel_pricing_rules_type_currency_active
  ON hotel_industry.pricing_rules(rule_type, currency, is_active)
  WHERE is_active = true;

DROP INDEX hotel_industry.idx_hotel_pricing_rules_room_season;
CREATE INDEX idx_hotel_pricing_rules_room_season
  ON hotel_industry.pricing_rules(room_type, season, is_active)
  WHERE is_active = true;

ALTER TABLE hotel_industry.pricing_rules
  DROP COLUMN hotel_id,
  DROP COLUMN room_type_id,
  ADD CONSTRAINT unique_hotel_rule_type_currency
    UNIQUE (rule_type, currency, room_type, season);
