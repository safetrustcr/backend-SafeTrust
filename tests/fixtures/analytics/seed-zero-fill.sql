-- seed-zero-fill.sql
-- Diagram 1: zero-filled days fixture (no events, no users, no escrows in range)
-- Tests that get_escrow_analytics_by_day returns all days with count = 0 and no NULL rows

DELETE FROM safetrust.trustless_work_webhook_events
WHERE contract_id LIKE 'test-ana-%';

DELETE FROM safetrust.trustless_work_escrows
WHERE contract_id LIKE 'test-ana-%';

DELETE FROM safetrust.user_roles
WHERE user_id LIKE 'test-ana-%';

DELETE FROM safetrust.users
WHERE id LIKE 'test-ana-%';
