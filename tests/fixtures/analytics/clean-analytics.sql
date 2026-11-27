-- clean-analytics.sql
-- Clean up all test fixtures inserted with prefix 'test-ana-%'
-- Safe for repeated runs and teardown before/after tests

DELETE FROM safetrust.trustless_work_webhook_events
WHERE contract_id LIKE 'test-ana-%';

DELETE FROM safetrust.trustless_work_escrows
WHERE contract_id LIKE 'test-ana-%';

DELETE FROM safetrust.user_roles
WHERE user_id LIKE 'test-ana-%';

DELETE FROM safetrust.users
WHERE id LIKE 'test-ana-%';
