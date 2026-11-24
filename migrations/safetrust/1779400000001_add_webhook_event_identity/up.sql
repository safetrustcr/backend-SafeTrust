-- Assign existing rows unique legacy identities before enforcing uniqueness.
ALTER TABLE safetrust.trustless_work_webhook_events
  ADD COLUMN event_identity TEXT;

UPDATE safetrust.trustless_work_webhook_events
SET event_identity = 'legacy:' || id::text
WHERE event_identity IS NULL;

ALTER TABLE safetrust.trustless_work_webhook_events
  ALTER COLUMN event_identity SET NOT NULL;

ALTER TABLE safetrust.trustless_work_webhook_events
  ADD CONSTRAINT unique_trustless_work_webhook_event_identity
  UNIQUE (tenant_id, event_identity);

COMMENT ON COLUMN safetrust.trustless_work_webhook_events.event_identity IS
  'Stable logical event identity supplied by the provider or derived from the event payload';
