-- Seed for escrow_transactions table
-- Using safetrust.escrow_transactions (canonical escrow transaction log)
--
-- escrow_transactions references trustless_work_escrows through escrow_id.
-- The escrow rows below are the source of truth for status/balance; each
-- transaction records the signed deploy/fund transaction against that escrow.

-- Clear existing seed data (development only)
DELETE FROM safetrust.escrow_transactions
WHERE escrow_id IN (
  SELECT id FROM safetrust.trustless_work_escrows
  WHERE contract_id LIKE 'contract-00%'
);

DELETE FROM safetrust.trustless_work_escrows
WHERE contract_id LIKE 'contract-00%';

INSERT INTO safetrust.trustless_work_escrows (
  contract_id, marker, approver, releaser,
  escrow_type, status, asset_code, amount, balance, tenant_id, apartment_id
) VALUES
  (
    'contract-001', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GRELEASER000000000000000000000000000000000000000000000001',
    'single_release', 'pending_funding', 'USDC', 500.00, 0, 'safetrust',
    '550e8400-e29b-41d4-a716-446655440001'::uuid
  ),
  (
    'contract-002', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GRELEASER000000000000000000000000000000000000000000000001',
    'single_release', 'funded', 'USDC', 300.00, 300.00, 'safetrust',
    '550e8400-e29b-41d4-a716-446655440002'::uuid
  ),
  (
    'contract-003', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GRELEASER000000000000000000000000000000000000000000000001',
    'single_release', 'completed', 'USDC', 400.00, 0, 'safetrust',
    '550e8400-e29b-41d4-a716-446655440001'::uuid
  ),
  (
    'contract-004', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GRELEASER000000000000000000000000000000000000000000000001',
    'single_release', 'cancelled', 'USDC', 400.00, 0, 'safetrust', NULL
  ),
  (
    'contract-005', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GRELEASER000000000000000000000000000000000000000000000001',
    'single_release', 'disputed', 'USDC', 250.00, 250.00, 'safetrust',
    '550e8400-e29b-41d4-a716-446655440002'::uuid
  ),
  (
    'contract-006', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GRELEASER000000000000000000000000000000000000000000000001',
    'single_release', 'resolved', 'USDC', 250.00, 0, 'safetrust',
    '550e8400-e29b-41d4-a716-446655440001'::uuid
  );

INSERT INTO safetrust.escrow_transactions (
    escrow_id,
    kind,
    engagement_id,
    sender_address,
    receiver_address,
    status,
    unsigned_xdr,
    tenant_id,
    created_at,
    updated_at
)
SELECT
    e.id,
    'fund',
    v.engagement_id,
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    v.status,
    NULL,
    'safetrust',
    NOW() - v.created_ago,
    NOW()
FROM (VALUES
    ('contract-001', 'engagement-001', 'pending_signature', INTERVAL '4 days'),
    ('contract-002', '46bb85be-4d2c-49af-88dd-cd80f46b1502', 'funded', INTERVAL '1 day'),
    ('contract-003', '2f6104ff-13c7-44e0-b778-32ab6b747b5a', 'completed', INTERVAL '4 days'),
    ('contract-004', 'd7c2578a-a30f-42f0-a7c5-fefe8f31815d', 'cancelled', INTERVAL '4 days'),
    ('contract-005', 'engagement-005', 'disputed', INTERVAL '3 days'),
    ('contract-006', '94ad3e1d-453b-4399-a790-ad42bedd9350', 'resolved', INTERVAL '4 days')
) AS v(contract_id, engagement_id, status, created_ago)
JOIN safetrust.trustless_work_escrows e ON e.contract_id = v.contract_id;
