-- seed-multi-asset.sql
-- Diagram 1: multi-asset escrows fixture
-- Tests numeric aggregation and policy enforcement across multiple assets (USDC, XLM, EURC)

DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'test-ana-%';
DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE 'test-ana-%';

-- Escrow 1: USDC (primary currency) - Funded
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-asset-usdc',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'funded',
  500.00,
  500.00,
  'USDC',
  'safetrust',
  '2026-10-15 09:00:00+00'
);

-- Escrow 2: XLM (native asset) - Active
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-asset-xlm',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'active',
  250.00,
  250.00,
  'XLM',
  'safetrust',
  '2026-10-15 11:30:00+00'
);

-- Escrow 3: EURC (Euro token) - Created (pending funding)
INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id, created_at
) VALUES (
  'test-ana-asset-eurc',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'created',
  150.00,
  0.00,
  'EURC',
  'safetrust',
  '2026-10-15 14:00:00+00'
);
