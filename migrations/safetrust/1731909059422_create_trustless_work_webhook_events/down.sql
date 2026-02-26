-- Migration: Drop Trustless Work Webhook Events Table
-- Description: Reverses the webhook events infrastructure.
-- Author: Antigravity Refactor

-- ============================================================================
-- 1. DROP INDEXES
-- ============================================================================
DROP INDEX IF EXISTS idx_webhook_events_contract_id;
DROP INDEX IF EXISTS idx_webhook_events_processed;
DROP INDEX IF EXISTS idx_webhook_events_created_at;
DROP INDEX IF EXISTS idx_webhook_events_event_type;
DROP INDEX IF EXISTS idx_webhook_events_retry;
DROP INDEX IF EXISTS idx_webhook_events_tenant;

-- ============================================================================
-- 2. DROP TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.trustless_work_webhook_events CASCADE;
