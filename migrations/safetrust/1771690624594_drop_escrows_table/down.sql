CREATE TABLE IF NOT EXISTS public.escrows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      TEXT NOT NULL,
  engagement_id    TEXT NOT NULL,
  property_id      TEXT NOT NULL,
  sender_address   TEXT NOT NULL,
  receiver_address TEXT NOT NULL,
  amount           NUMERIC(20, 7) NOT NULL CHECK (amount > 0),
  status           TEXT NOT NULL DEFAULT 'pending_signature',
  unsigned_xdr     TEXT,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  tenant_id        VARCHAR(255) NOT NULL DEFAULT 'safetrust',
  CONSTRAINT valid_escrow_status CHECK (status IN (
    'deploying', 'pending_signature', 'funded', 'completed', 'disputed', 'resolved', 'cancelled'
  )),
  CONSTRAINT unique_engagement UNIQUE (engagement_id)
);

CREATE INDEX IF NOT EXISTS idx_escrows_contract_id      ON public.escrows (contract_id);
CREATE INDEX IF NOT EXISTS idx_escrows_property_id      ON public.escrows (property_id);
CREATE INDEX IF NOT EXISTS idx_escrows_sender_address   ON public.escrows (sender_address);
CREATE INDEX IF NOT EXISTS idx_escrows_receiver_address ON public.escrows (receiver_address);
CREATE INDEX IF NOT EXISTS idx_escrows_status           ON public.escrows (status);
CREATE INDEX IF NOT EXISTS idx_escrows_tenant           ON public.escrows (tenant_id);

CREATE OR REPLACE FUNCTION public.set_escrows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS escrows_set_updated_at ON public.escrows;
CREATE TRIGGER escrows_set_updated_at
  BEFORE UPDATE ON public.escrows
  FOR EACH ROW EXECUTE FUNCTION public.set_escrows_updated_at();