CREATE TABLE IF NOT EXISTS safetrust.listing_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apartment_id  UUID NOT NULL REFERENCES safetrust.apartments(id) ON DELETE CASCADE,
  reporter_id   TEXT NOT NULL REFERENCES safetrust.users(id),
  category      VARCHAR(30) NOT NULL CHECK (category IN
                  ('inaccurate', 'scam_or_fraud', 'offensive', 'safety', 'duplicate', 'other')),
  details       TEXT CHECK (details IS NULL OR char_length(details) <= 1000),
  status        VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  client_op_id  UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listing_reports_idempotent UNIQUE (reporter_id, client_op_id),
  CONSTRAINT listing_reports_other_needs_details CHECK (category <> 'other' OR char_length(btrim(coalesce(details, ''))) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_listing_reports_open ON safetrust.listing_reports (status, created_at DESC);
