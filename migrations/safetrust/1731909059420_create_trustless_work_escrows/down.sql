-- Migration: Drop Trustless Work Escrows Table
-- Description: Reverses the escrow tracking infrastructure.
-- Author: Antigravity Refactor

-- ============================================================================
-- 1. DROP INDEXES (Dropped automatically with table, keeping for clarity)
-- ============================================================================
-- DROP INDEX IF EXISTS idx_trustless_escrows_contract_id;
-- DROP INDEX IF EXISTS idx_trustless_escrows_booking_id;
-- DROP INDEX IF EXISTS idx_trustless_escrows_status;
-- DROP INDEX IF EXISTS idx_trustless_escrows_hotel_id;
-- DROP INDEX IF EXISTS idx_trustless_escrows_guest_id;
-- DROP INDEX IF EXISTS idx_trustless_escrows_tenant;
-- DROP INDEX IF EXISTS idx_trustless_escrows_created_at;

-- ============================================================================
-- 2. DROP TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.trustless_work_escrows CASCADE;
