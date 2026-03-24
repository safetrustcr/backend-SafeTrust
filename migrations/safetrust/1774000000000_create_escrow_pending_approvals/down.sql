-- Migration: Drop Escrow Pending Approvals Table
-- Description: Reverses the approval tracking infrastructure.
-- Author: SafeTrust Development Team
-- Date: 2026-03-24

-- ============================================================================
-- 1. DROP TABLE WITH CASCADE
-- ============================================================================
-- Note: CASCADE will drop any dependent objects including the Hasura event trigger
DROP TABLE IF EXISTS public.escrow_pending_approvals CASCADE;
