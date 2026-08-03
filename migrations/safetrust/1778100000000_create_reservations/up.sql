-- Migration: Create Reservations Table (safetrust tenant)
-- Description: Tracks apartment booking intent from BOOK click through
--              the full escrow lifecycle. Links to trustless_work_escrows
--              after TrustlessWork confirms the escrow on-chain.
-- Depends on: public.apartments, public.users, public.trustless_work_escrows

CREATE TABLE IF NOT EXISTS public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core booking fields
  apartment_id UUID NOT NULL REFERENCES public.apartments(id) ON DELETE RESTRICT,
  guest_id     TEXT NOT NULL REFERENCES public.users(id)      ON DELETE RESTRICT,

  -- Escrow link — NULL until initialize.handler.js fires
  escrow_id UUID REFERENCES public.trustless_work_escrows(id) ON DELETE SET NULL,

  -- Booking timeline
  check_in_date  TIMESTAMP WITH TIME ZONE NOT NULL,
  check_out_date TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Pricing snapshot at booking time
  total_amount DECIMAL(20, 7) NOT NULL,
  asset_code   VARCHAR(10) NOT NULL DEFAULT 'USDC',

  -- Booking status — mirrors escrow lifecycle
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  CONSTRAINT valid_reservation_status CHECK (status IN (
    'pending',        -- guest hit BOOK, no escrow yet
    'escrow_created', -- initialize.handler.js fired, escrow on-chain
    'funded',         -- fund.handler.js fired, funds in escrow
    'checked_in',     -- milestone approved (check-in)
    'checked_out',    -- milestone approved (check-out)
    'completed',      -- funds released to host
    'disputed',       -- dispute opened
    'resolved',       -- dispute resolved
    'cancelled'       -- cancelled before funding
  )),

  -- Tracking
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id  VARCHAR(255) NOT NULL DEFAULT 'safetrust'
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_reservations_apartment_id
  ON public.reservations(apartment_id);
CREATE INDEX IF NOT EXISTS idx_reservations_guest_id
  ON public.reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_reservations_escrow_id
  ON public.reservations(escrow_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status
  ON public.reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_dates
  ON public.reservations(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant
  ON public.reservations(tenant_id);

-- ============================================================================
-- DOCUMENTATION
-- ============================================================================
COMMENT ON TABLE public.reservations
  IS 'Apartment booking records — linked to trustless_work_escrows after on-chain deployment';
COMMENT ON COLUMN public.reservations.escrow_id
  IS 'Set by initialize.handler.js after TrustlessWork confirms escrow on-chain. NULL until then.';
COMMENT ON COLUMN public.reservations.status
  IS 'Mirrors escrow lifecycle — updated by each webhook handler alongside trustless_work_escrows';
COMMENT ON COLUMN public.reservations.total_amount
  IS 'Pricing snapshot at booking time — separate from escrow amount which may differ after fees';