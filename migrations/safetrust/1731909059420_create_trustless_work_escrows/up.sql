-- Migration: Create Trustless Work Escrows Table
-- Description: Sets up the main table for tracking escrow transactions between 
--              Hotels, Guests, and the Platform using Trustless Work protocols.
-- Author: Antigravity Refactor

-- ============================================================================
-- 1. TABLE DEFINITION
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.trustless_work_escrows (
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
  booking_id VARCHAR(255), -- References hotel_bookings(id)
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

  -- Status constraints
  CONSTRAINT valid_escrow_status CHECK (status IN (
    'created', 'pending_funding', 'funded', 'active',
    'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled'
  ))
);

-- ============================================================================
-- 2. PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_contract_id ON public.trustless_work_escrows(contract_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_booking_id ON public.trustless_work_escrows(booking_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_status ON public.trustless_work_escrows(status);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_hotel_id ON public.trustless_work_escrows(hotel_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_guest_id ON public.trustless_work_escrows(guest_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_tenant ON public.trustless_work_escrows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trustless_escrows_created_at ON public.trustless_work_escrows(created_at);

-- ============================================================================
-- 3. DOCUMENTATION (PostgreSQL Comments)
-- ============================================================================
COMMENT ON TABLE public.trustless_work_escrows IS 'Trustless Work escrow transactions for hotel bookings';
COMMENT ON COLUMN public.trustless_work_escrows.contract_id IS 'Unique identifier from Trustless Work smart contract';
COMMENT ON COLUMN public.trustless_work_escrows.marker IS 'Hotel wallet address that marks/creates the escrow';
COMMENT ON COLUMN public.trustless_work_escrows.approver IS 'Guest wallet address that approves milestones';
COMMENT ON COLUMN public.trustless_work_escrows.releaser IS 'Platform wallet address that releases funds';
