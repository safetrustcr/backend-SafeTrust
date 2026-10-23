-- seed-analytics-standard.sql
-- Baseline standard dataset spanning 2026-10-01 to 2026-10-05
-- Exercises get_escrow_analytics_by_day and get_escrow_status_summary

-- 1. Teardown existing test fixtures
DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.user_roles WHERE user_id LIKE 'test-ana-%';
DELETE FROM safetrust.users WHERE id LIKE 'test-ana-%';

-- 2. Seed Users
INSERT INTO safetrust.users (id, firebase_uid, email, first_name, last_name, last_seen)
VALUES
  ('test-ana-user-01', 'test-ana-user-01', 'ana-u1@safetrust.cr', 'Alice', 'User', '2026-10-01 10:00:00+00'),
  ('test-ana-user-02', 'test-ana-user-02', 'ana-u2@safetrust.cr', 'Bob',   'User', '2026-10-02 11:30:00+00'),
  ('test-ana-user-03', 'test-ana-user-03', 'ana-u3@safetrust.cr', 'Carol', 'User', '2026-10-02 15:45:00+00');

-- 3. Seed Webhook Events
-- Day 2026-10-01: 2 events (1 processed, 1 unprocessed)
INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, processed, processed_at, created_at, tenant_id)
VALUES
  ('test-ana-std-01', 'escrow.created', '{"contract_id": "test-ana-std-01"}', true,  '2026-10-01 08:30:00+00', '2026-10-01 08:30:00+00', 'safetrust'),
  ('test-ana-std-01', 'escrow.funded',  '{"contract_id": "test-ana-std-01"}', false, NULL,                    '2026-10-01 09:15:00+00', 'safetrust');

-- Day 2026-10-02: 3 events (all 3 processed)
INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, processed, processed_at, created_at, tenant_id)
VALUES
  ('test-ana-std-02', 'escrow.created', '{"contract_id": "test-ana-std-02"}', true, '2026-10-02 09:00:00+00', '2026-10-02 09:00:00+00', 'safetrust'),
  ('test-ana-std-02', 'escrow.funded',  '{"contract_id": "test-ana-std-02"}', true, '2026-10-02 10:00:00+00', '2026-10-02 10:00:00+00', 'safetrust'),
  ('test-ana-std-02', 'escrow.active',  '{"contract_id": "test-ana-std-02"}', true, '2026-10-02 14:00:00+00', '2026-10-02 14:00:00+00', 'safetrust');

-- Day 2026-10-03: 0 events (tests partial zero day within range)

-- Day 2026-10-04: 1 event (processed)
INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, processed, processed_at, created_at, tenant_id)
VALUES
  ('test-ana-std-04', 'escrow.completed', '{"contract_id": "test-ana-std-04"}', true, '2026-10-04 12:00:00+00', '2026-10-04 12:00:00+00', 'safetrust');

-- Day 2026-10-05: 1 event (processed)
INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, processed, processed_at, created_at, tenant_id)
VALUES
  ('test-ana-std-05', 'escrow.disputed', '{"contract_id": "test-ana-std-05"}', true, '2026-10-05 16:20:00+00', '2026-10-05 16:20:00+00', 'safetrust');

-- 4. Seed Escrows
-- Active escrows: funded (Day 1), active (Day 2), milestone_approved (Day 3)
-- Completed escrow: completed (Day 4)
-- Disputed escrow: disputed (Day 5)
-- Pending escrow: created (Day 5)
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES
  ('test-ana-std-01', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111', 'GRELEASER111WALLETADDRESS111111111111111111111111111111111', 'single_release', 'funded',             1000.00, 1000.00, 'USDC', 'safetrust', '2026-10-01 09:00:00+00'),
  ('test-ana-std-02', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111', 'GRELEASER111WALLETADDRESS111111111111111111111111111111111', 'single_release', 'active',              500.00,  500.00, 'USDC', 'safetrust', '2026-10-02 10:30:00+00'),
  ('test-ana-std-03', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111', 'GRELEASER111WALLETADDRESS111111111111111111111111111111111', 'single_release', 'milestone_approved',  750.00,  750.00, 'USDC', 'safetrust', '2026-10-03 11:00:00+00'),
  ('test-ana-std-04', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111', 'GRELEASER111WALLETADDRESS111111111111111111111111111111111', 'single_release', 'completed',          1200.00,    0.00, 'USDC', 'safetrust', '2026-10-04 12:00:00+00'),
  ('test-ana-std-05', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111', 'GRELEASER111WALLETADDRESS111111111111111111111111111111111', 'single_release', 'disputed',            300.00,  300.00, 'USDC', 'safetrust', '2026-10-05 14:00:00+00'),
  ('test-ana-std-06', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111', 'GRELEASER111WALLETADDRESS111111111111111111111111111111111', 'single_release', 'created',             400.00,    0.00, 'USDC', 'safetrust', '2026-10-05 15:00:00+00');
