-- Create trustless work escrows table
CREATE TABLE IF NOT EXISTS public.create_escrow_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Trustless Work standard fields (align with blocks)
  contract_id VARCHAR(255) UNIQUE NOT NULL,
  marker VARCHAR(255) NOT NULL,           -- Hotel wallet address
  approver VARCHAR(255) NOT NULL,         -- Guest wallet address  
  releaser VARCHAR(255) NOT NULL,         -- Platform wallet address
  resolver VARCHAR(255),                  -- Dispute resolver address
  
  -- Escrow configuration
  escrow_type VARCHAR(50) NOT NULL CHECK (escrow_type IN ('single_release', 'multi_release')),
  status VARCHAR(50) NOT NULL,
  asset_code VARCHAR(10) NOT NULL DEFAULT 'USDC',
  asset_issuer VARCHAR(255),
  amount DECIMAL(20, 7) NOT NULL,
  balance DECIMAL(20, 7) DEFAULT 0,
  
  -- Hotel booking specific fields
  booking_id VARCHAR(255), -- References hotel_bookings(id) - will add FK later
  room_id VARCHAR(255),
  hotel_id VARCHAR(255),
  guest_id VARCHAR(255),
  
  -- Booking timeline
  check_in_date TIMESTAMP WITH TIME ZONE,
  check_out_date TIMESTAMP WITH TIME ZONE,
  booking_created_at TIMESTAMP WITH TIME ZONE,
  
  -- Escrow metadata (JSON for flexibility)
  escrow_metadata JSONB,                  -- Trustless Work escrow data
  booking_metadata JSONB,                 -- Hotel booking specific data
  
  -- Tracking fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',
  
  -- Constraints
  CONSTRAINT valid_escrow_status CHECK (status IN (
    'created', 'pending_funding', 'funded', 'active', 
    'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled'
  ))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_contract_id ON public.create_escrow_transaction(contract_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_booking_id ON public.create_escrow_transaction(booking_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_status ON public.create_escrow_transaction(status);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_hotel_id ON public.create_escrow_transaction(hotel_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_guest_id ON public.create_escrow_transaction(guest_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_tenant ON public.create_escrow_transaction(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_created_at ON public.create_escrow_transaction(created_at);

-- Add comments for documentation
COMMENT ON TABLE public.create_escrow_transaction IS 'Trustless Work escrow transactions for hotel bookings';
COMMENT ON COLUMN public.create_escrow_transaction.contract_id IS 'Unique identifier from Trustless Work smart contract';
COMMENT ON COLUMN public.create_escrow_transaction.marker IS 'Hotel wallet address that marks/creates the escrow';
COMMENT ON COLUMN public.create_escrow_transaction.approver IS 'Guest wallet address that approves milestones';
COMMENT ON COLUMN public.create_escrow_transaction.releaser IS 'Platform wallet address that releases funds';
