-- Migration: Create Escrow Pending Approvals Table
-- Description: Sets up the approval tracking table for escrow transactions that require
--              manual approval. Triggers a webhook event when new approval requests are created.
-- Author: SafeTrust Development Team
-- Date: 2026-03-24

-- ============================================================================
-- 1. TABLE DEFINITION
-- ============================================================================
CREATE TABLE public.escrow_pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to main escrow table
  escrow_id UUID NOT NULL REFERENCES public.trustless_work_escrows(id) ON DELETE CASCADE,

  -- Approval status
  status VARCHAR(50) NOT NULL DEFAULT 'pending',

  -- User who requested the approval (wallet address or user ID)
  requested_by VARCHAR(255) NOT NULL,

  -- User who approved/rejected (if applicable)
  approved_by VARCHAR(255),

  -- Approval decision reason/notes
  approval_notes TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,

  -- Tenant identifier for multi-tenancy support
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  -- Status validation constraint
  CONSTRAINT valid_approval_status CHECK (status IN (
    'pending', 'approved', 'rejected', 'cancelled'
  ))
);

-- ============================================================================
-- 2. PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_escrow_pending_approvals_escrow_id 
  ON public.escrow_pending_approvals(escrow_id);

CREATE INDEX IF NOT EXISTS idx_escrow_pending_approvals_status 
  ON public.escrow_pending_approvals(status);

CREATE INDEX IF NOT EXISTS idx_escrow_pending_approvals_requested_by 
  ON public.escrow_pending_approvals(requested_by);

CREATE INDEX IF NOT EXISTS idx_escrow_pending_approvals_tenant 
  ON public.escrow_pending_approvals(tenant_id);

CREATE INDEX IF NOT EXISTS idx_escrow_pending_approvals_created_at 
  ON public.escrow_pending_approvals(created_at);

-- ============================================================================
-- 3. DOCUMENTATION (PostgreSQL Comments)
-- ============================================================================
COMMENT ON TABLE public.escrow_pending_approvals IS 
  'Tracks escrow approval requests requiring manual intervention before milestone release';

COMMENT ON COLUMN public.escrow_pending_approvals.id IS 
  'Unique identifier for this approval request';

COMMENT ON COLUMN public.escrow_pending_approvals.escrow_id IS 
  'Foreign key reference to the trustless_work_escrows table';

COMMENT ON COLUMN public.escrow_pending_approvals.status IS 
  'Approval status: pending, approved, rejected, or cancelled';

COMMENT ON COLUMN public.escrow_pending_approvals.requested_by IS 
  'Wallet address or user ID that initiated the approval request';

COMMENT ON COLUMN public.escrow_pending_approvals.approved_by IS 
  'Wallet address or user ID that approved or rejected the request';

COMMENT ON COLUMN public.escrow_pending_approvals.approval_notes IS 
  'Additional notes or reason for approval/rejection decision';

-- ============================================================================
-- 4. TRIGGER FUNCTION FOR AUTOMATIC UPDATED_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION update_escrow_pending_approvals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. TRIGGER FOR AUTO-UPDATING UPDATED_AT ON UPDATE
-- ============================================================================
CREATE TRIGGER trg_update_updated_at_on_escrow_pending_approvals
  BEFORE UPDATE ON public.escrow_pending_approvals
  FOR EACH ROW
  EXECUTE FUNCTION update_escrow_pending_approvals_updated_at();
