-- seed-duplicate-delivery.sql
-- Diagram 1: duplicate delivery fixture (same webhook event delivered twice)
-- Tests event_count raw receipt vs processed_count deduplication semantics

DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE 'test-ana-%';

-- Duplicate webhook event delivery for the same contract_id on 2026-10-12
-- Delivery 1: Original successfully processed event
INSERT INTO safetrust.trustless_work_webhook_events (
  contract_id, event_type, payload, processed, processed_at, created_at, tenant_id
) VALUES (
  'test-ana-dup-001',
  'escrow.funded',
  '{"contract_id": "test-ana-dup-001", "delivery": 1}',
  true,
  '2026-10-12 10:00:00+00',
  '2026-10-12 10:00:00+00',
  'safetrust'
);

-- Delivery 2: Duplicate delivery (e.g. retry from network glitch, processed = false)
INSERT INTO safetrust.trustless_work_webhook_events (
  contract_id, event_type, payload, processed, processed_at, created_at, tenant_id
) VALUES (
  'test-ana-dup-001',
  'escrow.funded',
  '{"contract_id": "test-ana-dup-001", "delivery": 2}',
  false,
  NULL,
  '2026-10-12 10:05:00+00',
  'safetrust'
);

-- Associated unique escrow record
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-dup-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'funded',
  350.00,
  350.00,
  'USDC',
  'safetrust',
  '2026-10-12 10:00:00+00'
);
