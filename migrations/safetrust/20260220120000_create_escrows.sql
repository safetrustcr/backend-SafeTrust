-- Create escrows table for single-release security deposit escrows
CREATE TABLE IF NOT EXISTS public.escrows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      TEXT NOT NULL,
  engagement_id    TEXT NOT NULL,
  property_id      TEXT NOT NULL,
  sender_address   TEXT NOT NULL,          -- Tenant Stellar public key
  receiver_address TEXT NOT NULL,          -- Owner Stellar public key
  amount           NUMERIC(20, 7) NOT NULL CHECK (amount > 0),
  status           TEXT NOT NULL DEFAULT 'pending_signature',
  unsigned_xdr     TEXT,                   -- Returned to client for signing
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id        VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  -- Constraints
  CONSTRAINT valid_escrow_status CHECK (status IN (
    'pending_signature', 'funded', 'completed', 'disputed', 'resolved', 'cancelled'
  )),
  CONSTRAINT unique_engagement UNIQUE (engagement_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_escrows_contract_id      ON public.escrows (contract_id);
CREATE INDEX IF NOT EXISTS idx_escrows_engagement_id    ON public.escrows (engagement_id);
CREATE INDEX IF NOT EXISTS idx_escrows_property_id      ON public.escrows (property_id);
CREATE INDEX IF NOT EXISTS idx_escrows_sender_address   ON public.escrows (sender_address);
CREATE INDEX IF NOT EXISTS idx_escrows_receiver_address ON public.escrows (receiver_address);
CREATE INDEX IF NOT EXISTS idx_escrows_status           ON public.escrows (status);
CREATE INDEX IF NOT EXISTS idx_escrows_tenant           ON public.escrows (tenant_id);

-- Auto-update updated_at
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

-- Comments
COMMENT ON TABLE  public.escrows                  IS 'Single-release escrow contracts for security deposits';
COMMENT ON COLUMN public.escrows.contract_id      IS 'On-chain contract address (engagementId pre-signature)';
COMMENT ON COLUMN public.escrows.engagement_id    IS 'Unique identifier sent to Trustless Work API';
COMMENT ON COLUMN public.escrows.sender_address   IS 'Tenant Stellar public key (signer)';
COMMENT ON COLUMN public.escrows.receiver_address IS 'Owner Stellar public key (receives funds on release)';
COMMENT ON COLUMN public.escrows.unsigned_xdr     IS 'Unsigned transaction returned to client for wallet signing';
COMMENT ON COLUMN public.escrows.tenant_id        IS 'Multi-tenant identifier';