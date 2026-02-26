-- Migration: Create escrow_pending_approvals table
-- Description: Tracks superadmin/admin changes to escrows that require customer approval
-- Author: SafeTrust Team
-- Date: 2026-02-26

CREATE TABLE IF NOT EXISTS public.escrow_pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES public.trustless_work_escrows(id) ON DELETE CASCADE,

  field_changed VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB,

  changed_by_role VARCHAR(50) NOT NULL,
  changed_by_user_id UUID,

  requires_customer_approval BOOLEAN DEFAULT TRUE,
  customer_approved BOOLEAN DEFAULT FALSE,
  customer_approved_at TIMESTAMP WITH TIME ZONE,
  customer_wallet_address VARCHAR(255),

  unsigned_xdr TEXT,
  signed_xdr TEXT,

  status VARCHAR(50) DEFAULT 'pending_approval',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  CONSTRAINT valid_approval_status CHECK (status IN (
    'pending_approval', 'approved', 'rejected', 'expired'
  ))
);

-- Create indexes for optimized queries
CREATE INDEX idx_pending_approvals_escrow ON public.escrow_pending_approvals(escrow_id);
CREATE INDEX idx_pending_approvals_status ON public.escrow_pending_approvals(status);
CREATE INDEX idx_pending_approvals_wallet ON public.escrow_pending_approvals(customer_wallet_address);
CREATE INDEX idx_pending_approvals_tenant ON public.escrow_pending_approvals(tenant_id);

-- Trigger function to detect superadmin/admin changes
CREATE OR REPLACE FUNCTION notify_escrow_change()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Get the Hasura role from session variable
  v_role := current_setting('hasura.user.x-hasura-role', true);

  -- Only track changes made by privileged roles
  IF v_role IN ('superadmin', 'admin') THEN
    -- Check if status field changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.escrow_pending_approvals (
        escrow_id, field_changed, old_value, new_value,
        changed_by_role, requires_customer_approval, status, tenant_id
      ) VALUES (
        NEW.id, 'status',
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status),
        v_role, TRUE, 'pending_approval', NEW.tenant_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to trustless_work_escrows table
CREATE TRIGGER escrow_change_approval_trigger
  AFTER UPDATE ON public.trustless_work_escrows
  FOR EACH ROW
  EXECUTE FUNCTION notify_escrow_change();

-- Add comment for documentation
COMMENT ON TABLE public.escrow_pending_approvals IS 'Tracks superadmin/admin changes to escrows that require customer wallet signature approval';
COMMENT ON COLUMN public.escrow_pending_approvals.field_changed IS 'The field that was changed (e.g., status)';
COMMENT ON COLUMN public.escrow_pending_approvals.unsigned_xdr IS 'Unsigned Stellar XDR transaction for customer to sign';
COMMENT ON COLUMN public.escrow_pending_approvals.signed_xdr IS 'Customer-signed XDR transaction ready for submission';
