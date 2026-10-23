-- seed-tenants-roles.sql
-- Diagram 2: Role and tenant isolation fixture
-- Tests tenant data separation (safetrust vs hotel_industry) and role access permissions

DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.user_roles WHERE user_id LIKE 'test-ana-%';
DELETE FROM safetrust.users WHERE id LIKE 'test-ana-%';

-- 1. Tenant: safetrust
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-tenant-st-01',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'active',
  1000.00,
  1000.00,
  'USDC',
  'safetrust',
  '2026-10-18 10:00:00+00'
);

INSERT INTO safetrust.trustless_work_webhook_events (
  contract_id, event_type, payload, processed, processed_at, created_at, tenant_id
) VALUES (
  'test-ana-tenant-st-01',
  'escrow.active',
  '{"contract_id": "test-ana-tenant-st-01", "tenant": "safetrust"}',
  true,
  '2026-10-18 10:00:00+00',
  '2026-10-18 10:00:00+00',
  'safetrust'
);

-- 2. Tenant: hotel_industry (other tenant)
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-tenant-hi-01',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'active',
  8888.00,
  8888.00,
  'USDC',
  'hotel_industry',
  '2026-10-18 11:00:00+00'
);

INSERT INTO safetrust.trustless_work_webhook_events (
  contract_id, event_type, payload, processed, processed_at, created_at, tenant_id
) VALUES (
  'test-ana-tenant-hi-01',
  'escrow.active',
  '{"contract_id": "test-ana-tenant-hi-01", "tenant": "hotel_industry"}',
  true,
  '2026-10-18 11:00:00+00',
  '2026-10-18 11:00:00+00',
  'hotel_industry'
);

-- 3. Test users for role simulation
INSERT INTO safetrust.users (id, firebase_uid, email, first_name, last_name, last_seen)
VALUES
  ('test-ana-user-st', 'test-ana-user-st', 'st-user@safetrust.cr', 'SafeTrust', 'Member', '2026-10-18 10:00:00+00');
