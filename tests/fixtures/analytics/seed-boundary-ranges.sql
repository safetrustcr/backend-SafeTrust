-- seed-boundary-ranges.sql
-- Diagram 3: Boundary, range limit, and timezone fixtures
-- Tests:
--  1. Timezone boundary (23:30 UTC vs 00:30 UTC next day)
--  2. Day bucket alignment
--  3. Safe ranges for inverted and oversized queries

DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE 'test-ana-%';

-- Event & Escrow 1: 23:30:00 UTC on 2026-10-20 (17:30 Costa Rica local time on Oct 20)
INSERT INTO safetrust.trustless_work_webhook_events (
  contract_id, event_type, payload, processed, processed_at, created_at, tenant_id
) VALUES (
  'test-ana-tz-01',
  'escrow.funded',
  '{"contract_id": "test-ana-tz-01", "ts": "23:30 UTC"}',
  true,
  '2026-10-20 23:30:00+00',
  '2026-10-20 23:30:00+00',
  'safetrust'
);

INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-tz-01',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'funded',
  100.00,
  100.00,
  'USDC',
  'safetrust',
  '2026-10-20 23:30:00+00'
);

-- Event & Escrow 2: 00:30:00 UTC on 2026-10-21 (18:30 Costa Rica local time on Oct 20, but 00:30 UTC Oct 21)
INSERT INTO safetrust.trustless_work_webhook_events (
  contract_id, event_type, payload, processed, processed_at, created_at, tenant_id
) VALUES (
  'test-ana-tz-02',
  'escrow.active',
  '{"contract_id": "test-ana-tz-02", "ts": "00:30 UTC"}',
  true,
  '2026-10-21 00:30:00+00',
  '2026-10-21 00:30:00+00',
  'safetrust'
);

INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-tz-02',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'active',
  200.00,
  200.00,
  'USDC',
  'safetrust',
  '2026-10-21 00:30:00+00'
);
