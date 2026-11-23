-- Seed for escrow_transactions table
-- Using safetrust.escrow_transactions (signed transactions referencing safetrust.trustless_work_escrows)

-- Ensure prerequisite trustless_work_escrows exist for seeds
INSERT INTO safetrust.trustless_work_escrows (
    contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, balance, tenant_id, created_at, updated_at
) VALUES
('contract-001', 'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'single_release', 'created', 'USDC', 500.00, 0.00, 'safetrust', NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'),
('contract-002', 'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'single_release', 'funded', 'USDC', 300.00, 300.00, 'safetrust', NOW() - INTERVAL '1 day', NOW()),
('contract-003', 'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'single_release', 'completed', 'USDC', 400.00, 0.00, 'safetrust', NOW() - INTERVAL '4 days', NOW() - INTERVAL '2 days'),
('contract-004', 'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'single_release', 'cancelled', 'USDC', 400.00, 0.00, 'safetrust', NOW() - INTERVAL '4 days', NOW() - INTERVAL '2 days'),
('contract-005', 'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'single_release', 'disputed', 'USDC', 250.00, 250.00, 'safetrust', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day'),
('contract-006', 'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3', 'single_release', 'resolved', 'USDC', 250.00, 0.00, 'safetrust', NOW() - INTERVAL '4 days', NOW() - INTERVAL '2 days')
ON CONFLICT (contract_id) DO NOTHING;

-- Clear existing seed data (development only)
TRUNCATE safetrust.escrow_transactions RESTART IDENTITY CASCADE;

INSERT INTO safetrust.escrow_transactions (
    id,
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
) VALUES
-- Scenario 1: Pending signature
(
    gen_random_uuid(),
    (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'contract-001'),
    'deploy',
    'engagement-001',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    'pending_signature',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '1 day'
),
-- Scenario 2: Funded
(
    gen_random_uuid(),
    (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'contract-002'),
    'fund',
    '46bb85be-4d2c-49af-88dd-cd80f46b1502',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    'confirmed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '1 day',
    NOW()
),
-- Scenario 3: Completed
(
    gen_random_uuid(),
    (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'contract-003'),
    'release',
    '2f6104ff-13c7-44e0-b778-32ab6b747b5a',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    'confirmed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 days'
),
-- Scenario 4: Cancelled
(
    gen_random_uuid(),
    (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'contract-004'),
    'deploy',
    'd7c2578a-a30f-42f0-a7c5-fefe8f31815d',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    'failed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 days'
),
-- Scenario 5: Disputed
(
    gen_random_uuid(),
    (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'contract-005'),
    'fund',
    'engagement-005',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    'confirmed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '3 days',
    NOW() - INTERVAL '1 day'
),
-- Scenario 6: Resolved
(
    gen_random_uuid(),
    (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'contract-006'),
    'release',
    '94ad3e1d-453b-4399-a790-ad42bedd9350',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    'confirmed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 days'
);
