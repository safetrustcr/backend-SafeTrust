-- Create escrow_pending_approvals table
-- This table tracks pending approvals when superadmin/admin modifies escrow status
-- Customer must sign off on changes via their wallet before they take effect
CREATE TABLE IF NOT EXISTS public.escrow_pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES public.trustless_work_escrows(id) ON DELETE RESTRICT,

  field_changed VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB,

  changed_by_role VARCHAR(50) NOT NULL,
  changed_by_user_id UUID,

  requires_customer_approval BOOLEAN NOT NULL DEFAULT TRUE,
  customer_approved BOOLEAN NOT NULL DEFAULT FALSE,
  customer_approved_at TIMESTAMP WITH TIME ZONE,
  customer_wallet_address VARCHAR(255),

  unsigned_xdr TEXT,
  signed_xdr TEXT,

  status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  CONSTRAINT valid_approval_status CHECK (status IN (
    'pending_approval', 'approved', 'rejected', 'expired'
  ))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pending_approvals_escrow ON public.escrow_pending_approvals(escrow_id);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON public.escrow_pending_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_wallet ON public.escrow_pending_approvals(customer_wallet_address);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_tenant ON public.escrow_pending_approvals(tenant_id);

-- Add comments for documentation
COMMENT ON TABLE public.escrow_pending_approvals IS 'Tracks pending customer approvals for privileged escrow status changes';
COMMENT ON COLUMN public.escrow_pending_approvals.escrow_id IS 'Reference to the escrow being modified';
COMMENT ON COLUMN public.escrow_pending_approvals.field_changed IS 'Name of the field that was changed (e.g., status)';
COMMENT ON COLUMN public.escrow_pending_approvals.old_value IS 'Previous value before the change (JSONB)';
COMMENT ON COLUMN public.escrow_pending_approvals.new_value IS 'New value after the change (JSONB)';
COMMENT ON COLUMN public.escrow_pending_approvals.changed_by_role IS 'Role that made the change (superadmin or admin)';
COMMENT ON COLUMN public.escrow_pending_approvals.customer_wallet_address IS 'Wallet address of the customer who must approve';
COMMENT ON COLUMN public.escrow_pending_approvals.unsigned_xdr IS 'Unsigned XDR transaction for customer to sign';
COMMENT ON COLUMN public.escrow_pending_approvals.signed_xdr IS 'Signed XDR transaction after customer approval';

-- Trigger function to detect privileged role updates and create pending approval records
-- Note: PostgreSQL triggers cannot directly access Hasura session variables.
-- This trigger attempts to read the role from Hasura session variables.
-- If the role cannot be determined (e.g., direct database updates), the trigger
-- will still create the approval record with changed_by_role set to NULL.
-- The application layer should handle role detection for direct database updates.
CREATE OR REPLACE FUNCTION notify_escrow_change()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_user_id TEXT;
  v_requested_status TEXT;
BEGIN
  -- Attempt to get the role from Hasura session variable
  -- This will only work when the update comes through Hasura GraphQL API
  BEGIN
    v_role := current_setting('hasura.user.x-hasura-role', true);
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;
  
  -- Attempt to get the user ID from Hasura session variable (if available)
  BEGIN
    v_user_id := current_setting('hasura.user.x-hasura-user-id', true);
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Only create pending approval if change is made by superadmin or admin
  -- If role cannot be determined, skip creating the approval record
  -- (This handles cases where updates come directly from the database, not through Hasura)
  IF v_role IN ('superadmin', 'admin') THEN
    -- Check if status field was changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      v_requested_status := NEW.status;
      INSERT INTO public.escrow_pending_approvals (
        escrow_id,
        field_changed,
        old_value,
        new_value,
        changed_by_role,
        changed_by_user_id,
        requires_customer_approval,
        status,
        customer_wallet_address,
        tenant_id
      ) VALUES (
        NEW.id,
        'status',
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', v_requested_status),
        COALESCE(v_role, 'unknown'),
        CASE WHEN v_user_id IS NOT NULL AND v_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN v_user_id::UUID ELSE NULL END,
        TRUE,
        'pending_approval',
        NEW.approver, -- Customer wallet address (guest/approver)
        NEW.tenant_id
      );

      -- Keep current status until customer signs
      NEW.status := OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to trustless_work_escrows table
CREATE TRIGGER escrow_change_approval_trigger
  BEFORE UPDATE ON public.trustless_work_escrows
  FOR EACH ROW
  EXECUTE FUNCTION notify_escrow_change();
