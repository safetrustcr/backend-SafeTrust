-- Create escrow milestones table for multi-release escrows
-- Note: This migration depends on the public.trustless_work_escrows table existing first
CREATE TABLE IF NOT EXISTS public.escrow_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES public.trustless_work_escrows(id) ON DELETE CASCADE,
  milestone_id VARCHAR(255) NOT NULL,     -- 'check_in', 'check_out', etc.
  description TEXT NOT NULL,
  amount DECIMAL(20, 7) NOT NULL,
  due_date TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by VARCHAR(255),               -- Wallet address of approver
  released_at TIMESTAMP WITH TIME ZONE,
  released_by VARCHAR(255),               -- Wallet address of releaser
  metadata JSONB,                         -- Milestone-specific data
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  -- Constraints
  CONSTRAINT valid_milestone_status CHECK (status IN (
    'pending', 'approved', 'disputed', 'released', 'cancelled'
  )),
  CONSTRAINT unique_escrow_milestone UNIQUE(escrow_id, milestone_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_milestones_escrow_id ON public.escrow_milestones(escrow_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON public.escrow_milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestones_due_date ON public.escrow_milestones(due_date);
CREATE INDEX IF NOT EXISTS idx_milestones_milestone_id ON public.escrow_milestones(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestones_tenant ON public.escrow_milestones(tenant_id);

-- Add comments
COMMENT ON TABLE public.escrow_milestones IS 'Milestone tracking for multi-release escrows';
COMMENT ON COLUMN public.escrow_milestones.milestone_id IS 'Business milestone identifier (check_in, check_out, etc.)';
COMMENT ON COLUMN public.escrow_milestones.approved_by IS 'Wallet address that approved this milestone';
COMMENT ON COLUMN public.escrow_milestones.released_by IS 'Wallet address that released funds for this milestone';