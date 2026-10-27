ALTER TABLE safetrust.trustless_work_webhook_events
  DROP CONSTRAINT unique_trustless_work_webhook_event_identity;

ALTER TABLE safetrust.trustless_work_webhook_events
  DROP COLUMN event_identity;
