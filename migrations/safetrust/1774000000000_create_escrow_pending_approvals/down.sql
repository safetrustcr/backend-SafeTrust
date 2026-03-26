-- Migration: Drop Escrow Pending Approvals Table
-- Description: Reverses the approval tracking infrastructure.
-- Author: SafeTrust Development Team
-- Date: 2026-03-24

-- ============================================================================
-- 1. DROP TRIGGER AND TRIGGER FUNCTION
-- ============================================================================
DROP TRIGGER IF EXISTS trg_update_updated_at_on_escrow_pending_approvals ON public.escrow_pending_approvals;

DROP FUNCTION IF EXISTS update_escrow_pending_approvals_updated_at();

-- ============================================================================
-- 2. DROP TABLE
-- ============================================================================
-- Note: CASCADE will drop any dependent objects including the Hasura event trigger
DROP TABLE public.escrow_pending_approvals CASCADE;
