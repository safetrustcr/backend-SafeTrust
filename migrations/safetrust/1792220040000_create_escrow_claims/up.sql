CREATE TABLE IF NOT EXISTS safetrust.escrow_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id      UUID NOT NULL REFERENCES safetrust.trustless_work_escrows(id) ON DELETE RESTRICT,
  reservation_id UUID REFERENCES safetrust.reservations(id) ON DELETE SET NULL,
  author_id      TEXT NOT NULL REFERENCES safetrust.users(id),
  body           TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 2000),
  status         VARCHAR(20) NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted', 'in_review', 'resolved', 'rejected')),
  client_op_id   UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT escrow_claims_idempotent UNIQUE (author_id, client_op_id)
);

CREATE INDEX IF NOT EXISTS idx_escrow_claims_escrow
  ON safetrust.escrow_claims (escrow_id, created_at DESC);

CREATE OR REPLACE FUNCTION safetrust.set_escrow_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_escrow_claims_updated_at ON safetrust.escrow_claims;
CREATE TRIGGER trg_escrow_claims_updated_at
  BEFORE UPDATE ON safetrust.escrow_claims
  FOR EACH ROW EXECUTE FUNCTION safetrust.set_escrow_claims_updated_at();
