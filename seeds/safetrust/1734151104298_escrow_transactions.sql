-- Seed for escrow_transactions table
-- Using public.escrows (canonical escrow table)

-- Clear existing seed data (development only)
TRUNCATE public.escrows RESTART IDENTITY CASCADE;

INSERT INTO public.escrows (
    id,
    contract_id,
    engagement_id,
    property_id,
    sender_address,
    receiver_address,
    amount,
    status,
    unsigned_xdr,
    tenant_id,
    created_at,
    updated_at
) VALUES
-- Scenario 1: Pending signature
(
    gen_random_uuid(),
    'contract-001',
    'engagement-001',
    'property-001',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    500.00,
    'pending_signature',
    NULL,
    'safetrust',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 day'
),
-- Scenario 2: Funded
(
    gen_random_uuid(),
    'contract-002',
    '46bb85be-4d2c-49af-88dd-cd80f46b1502',
    'property-002',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    300.00,
    'funded',
    NULL,
    'safetrust',
    NOW() - INTERVAL '1 day',
    NOW()
),
-- Scenario 3: Completed
(
    gen_random_uuid(),
    'contract-003',
    '2f6104ff-13c7-44e0-b778-32ab6b747b5a',
    'property-003',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    400.00,
    'completed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 days'
),
-- Scenario 4: Cancelled
(
    gen_random_uuid(),
    'contract-004',
    'd7c2578a-a30f-42f0-a7c5-fefe8f31815d',
    'property-004',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    400.00,
    'cancelled',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 days'
),
-- Scenario 5: Disputed
(
    gen_random_uuid(),
    'contract-005',
    'engagement-005',
    'property-005',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    250.00,
    'disputed',
    NULL,
    'safetrust',
    NOW() - INTERVAL '3 days',
    NOW() - INTERVAL '1 day'
),
-- Scenario 6: Resolved
(
    gen_random_uuid(),
    'contract-006',
    '94ad3e1d-453b-4399-a790-ad42bedd9350',
    'property-006',
    'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3',
    'GBVKI23OQZCANDUZ5PQBRRD3QJHYZQPMFKSFWMSKTG3OBHIJJAGMX2MB',
    250.00,
    'resolved',
    NULL,
    'safetrust',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 days'
);