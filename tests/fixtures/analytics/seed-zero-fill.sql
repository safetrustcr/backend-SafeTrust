-- seed-zero-fill.sql
-- Diagram 1: zero-filled days fixture (no events, no users, no escrows in range)
-- Tests that get_escrow_analytics_by_day returns all days with count = 0 and no NULL rows

DELETE FROM safetrust.trustless_work_webhook_events
WHERE contract_id LIKE 'test-ana-%'
   OR (created_at >= '2026-11-01 00:00:00+00' AND created_at < '2026-11-06 00:00:00+00');

DELETE FROM safetrust.trustless_work_escrows
WHERE contract_id LIKE 'test-ana-%'
   OR (created_at >= '2026-11-01 00:00:00+00' AND created_at < '2026-11-06 00:00:00+00');

DELETE FROM safetrust.users
WHERE id LIKE 'test-ana-%'
   OR (last_seen >= '2026-11-01 00:00:00+00' AND last_seen < '2026-11-06 00:00:00+00');
