-- Migration: Add hash index for O(1) webhook event deduplication lookup
-- Description: Partial hash index on contract_id for processed safetrust events

CREATE INDEX IF NOT EXISTS idx_webhook_events_contract_event_type
  ON public.trustless_work_webhook_events
  USING hash (contract_id)
  WHERE processed = true AND tenant_id = 'safetrust';
