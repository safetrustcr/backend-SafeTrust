DO $$
DECLARE
  hotel_count BIGINT;
  rule_count BIGINT;
  invalid_type_mapping_count BIGINT;
  duplicate_scope_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO hotel_count
  FROM hotel_industry.hotels;

  SELECT COUNT(*) INTO rule_count
  FROM hotel_industry.pricing_rules;

  IF hotel_count = 0 AND rule_count > 0 THEN
    RAISE EXCEPTION
      'Cannot scope % existing pricing rule(s): hotel_industry.hotels is empty',
      rule_count;
  END IF;

  SELECT COUNT(*) INTO invalid_type_mapping_count
  FROM hotel_industry.pricing_rules rule
  WHERE rule.room_type IS NOT NULL
    AND (
      SELECT COUNT(*)
      FROM hotel_industry.room_types room_type
      WHERE LOWER(BTRIM(room_type.name)) = LOWER(BTRIM(rule.room_type))
    ) <> 1;

  IF invalid_type_mapping_count > 0 THEN
    RAISE EXCEPTION
      'Cannot replace pricing_rules.room_type: % rule(s) do not have exactly one matching hotel_industry.room_types.name',
      invalid_type_mapping_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_scope_count
  FROM (
    SELECT
      rule.rule_name,
      rule.rule_type,
      rule.currency,
      room_type.id AS room_type_id,
      rule.season,
      rule.advance_booking_days
    FROM hotel_industry.pricing_rules rule
    LEFT JOIN hotel_industry.room_types room_type
      ON LOWER(BTRIM(room_type.name)) = LOWER(BTRIM(rule.room_type))
    GROUP BY
      rule.rule_name,
      rule.rule_type,
      rule.currency,
      room_type.id,
      rule.season,
      rule.advance_booking_days
    HAVING COUNT(*) > 1
  ) duplicate_scopes;

  IF duplicate_scope_count > 0 THEN
    RAISE EXCEPTION
      'Cannot scope pricing rules: % rules share the same named scope and advance-booking term',
      duplicate_scope_count;
  END IF;
END;
$$;

ALTER TABLE hotel_industry.pricing_rules
  DROP CONSTRAINT unique_hotel_rule_type_currency,
  ADD COLUMN hotel_id UUID,
  ADD COLUMN room_type_id UUID;

UPDATE hotel_industry.pricing_rules rule
SET room_type_id = room_type.id
FROM hotel_industry.room_types room_type
WHERE rule.room_type IS NOT NULL
  AND LOWER(BTRIM(room_type.name)) = LOWER(BTRIM(rule.room_type));

UPDATE hotel_industry.pricing_rules
SET hotel_id = (SELECT id FROM hotel_industry.hotels ORDER BY id LIMIT 1);

INSERT INTO hotel_industry.pricing_rules (
  rule_name,
  rule_type,
  currency,
  base_amount,
  percentage,
  min_amount,
  max_amount,
  room_type,
  season,
  advance_booking_days,
  priority,
  is_active,
  created_at,
  updated_at,
  hotel_id,
  room_type_id
)
SELECT
  rule.rule_name,
  rule.rule_type,
  rule.currency,
  rule.base_amount,
  rule.percentage,
  rule.min_amount,
  rule.max_amount,
  rule.room_type,
  rule.season,
  rule.advance_booking_days,
  rule.priority,
  rule.is_active,
  rule.created_at,
  rule.updated_at,
  hotel.id,
  rule.room_type_id
FROM hotel_industry.pricing_rules rule
CROSS JOIN hotel_industry.hotels hotel
WHERE hotel.id <> rule.hotel_id;

DROP INDEX hotel_industry.idx_hotel_pricing_rules_type_currency_active;
DROP INDEX hotel_industry.idx_hotel_pricing_rules_room_season;

ALTER TABLE hotel_industry.pricing_rules
  ALTER COLUMN hotel_id SET NOT NULL,
  ADD CONSTRAINT pricing_rules_hotel_id_fkey
    FOREIGN KEY (hotel_id)
    REFERENCES hotel_industry.hotels(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT pricing_rules_room_type_id_fkey
    FOREIGN KEY (room_type_id)
    REFERENCES hotel_industry.room_types(id)
    ON DELETE RESTRICT,
  DROP COLUMN room_type;

CREATE INDEX idx_hotel_pricing_rules_type_currency_active
  ON hotel_industry.pricing_rules(hotel_id, rule_type, currency, is_active)
  WHERE is_active = true;

CREATE INDEX idx_hotel_pricing_rules_room_season
  ON hotel_industry.pricing_rules(hotel_id, room_type_id, season, is_active)
  WHERE is_active = true;

ALTER TABLE hotel_industry.pricing_rules
  ADD CONSTRAINT unique_hotel_pricing_rule_scope
  UNIQUE NULLS NOT DISTINCT (
    hotel_id,
    rule_type,
    currency,
    room_type_id,
    season,
    rule_name,
    advance_booking_days
  );

COMMENT ON CONSTRAINT unique_hotel_pricing_rule_scope
  ON hotel_industry.pricing_rules IS
  'Rule name and advance-booking threshold distinguish valid parallel policies within one hotel scope.';

COMMENT ON COLUMN hotel_industry.pricing_rules.hotel_id IS
  'Pricing rules belong to one hotel. Existing global rules were copied to each hotel present when this migration ran.';
