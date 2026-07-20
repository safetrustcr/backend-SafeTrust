-- seed-test-escrows.sql
-- Test fixture for public.trustless_work_escrows
-- Aligned with migration: 1731909059420_create_trustless_work_escrows/up.sql
--
-- Valid statuses (CHECK constraint):
--   'created', 'pending_funding', 'funded', 'active',
--   'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled'
--
-- Valid escrow_type (CHECK constraint):
--   'single_release', 'multi_release'
--
-- Dependency: seed-test-users.sql must run first

DELETE FROM public.trustless_work_escrows
WHERE contract_id IN (
  'escrow-created-001',
  'escrow-pending-001',
  'escrow-funded-001',
  'escrow-disputed-001',
  'escrow-completed-001'
);

-- status: created
-- Used by: initialize.feature (duplicate contract_id test), fund.feature
INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  balance,
  asset_code,
  tenant_id,
  escrow_metadata
) VALUES (
  'escrow-created-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'created',
  2500.00,
  0.00,
  'USDC',
  'safetrust',
  '{"unsigned_transaction": "MOCK_UNSIGNED_XDR_CREATED"}'
);

-- status: pending_funding
-- Used by: fund handler pre-condition tests
INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  balance,
  asset_code,
  tenant_id,
  escrow_metadata
) VALUES (
  'escrow-pending-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'pending_funding',
  1800.00,
  0.00,
  'USDC',
  'safetrust',
  '{"unsigned_transaction": "MOCK_UNSIGNED_XDR_PENDING"}'
);

-- status: funded
-- Used by: milestone approval tests, reconciliation sync tests
INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  balance,
  asset_code,
  tenant_id,
  escrow_metadata
) VALUES (
  'escrow-funded-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'funded',
  3200.00,
  3200.00,
  'USDC',
  'safetrust',
  '{"unsigned_transaction": "MOCK_UNSIGNED_XDR_FUNDED"}'
);

-- status: disputed
-- Used by: open_dispute.feature, resolve dispute tests
INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  resolver,
  escrow_type,
  status,
  amount,
  balance,
  asset_code,
  tenant_id,
  escrow_metadata
) VALUES (
  'escrow-disputed-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'GRESOLVER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'disputed',
  2100.00,
  2100.00,
  'USDC',
  'safetrust',
  '{"unsigned_transaction": "MOCK_UNSIGNED_XDR_DISPUTED"}'
);

-- status: completed
-- Used by: sync-escrows.feature, reconciliation tests
INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  balance,
  asset_code,
  tenant_id,
  escrow_metadata
) VALUES (
  'escrow-completed-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'completed',
  2800.00,
  0.00,
  'USDC',
  'safetrust',
  '{"unsigned_transaction": "MOCK_UNSIGNED_XDR_COMPLETED"}'
);

-- Insert milestone for escrow-funded-001
INSERT INTO public.escrow_milestones (
  escrow_id,
  milestone_id,
  description,
  amount,
  due_date,
  status,
  approved_at,
  approved_by,
  released_at,
  released_by,
  metadata,
  tenant_id
)
SELECT 
  id,
  'check_in',
  'Guest check-in milestone',
  50.0000000,
  NOW() + INTERVAL '1 day',
  'pending',
  NULL,
  NULL,
  NULL,
  NULL,
  '{"type": "check_in"}'::jsonb,
  'safetrust'
FROM public.trustless_work_escrows 
WHERE contract_id = 'escrow-funded-001';

-- Test escrows for get-escrow-by-contract-ids.feature
-- Contract IDs CAATN5DTEST00001, CAATN5DTEST00002, CAATN5DTEST00003 used by new scenarios
DELETE FROM public.trustless_work_escrows WHERE contract_id IN ('CAATN5DTEST00001', 'CAATN5DTEST00002', 'CAATN5DTEST00003');
INSERT INTO public.trustless_work_escrows (
  contract_id, marker, approver, releaser, escrow_type, status, amount, balance, asset_code, tenant_id
) VALUES
  ('CAATN5DTEST00001', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER11111111111111111111111111111111111111111111111111', 'GRELEASER1111111111111111111111111111111111111111111111111', 'single_release', 'funded', 500.00, 300.00, 'USDC', 'safetrust'),
  ('CAATN5DTEST00002', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER22222222222222222222222222222222222222222222222222', 'GRELEASER2222222222222222222222222222222222222222222222222', 'single_release', 'funded', 1200.00, 800.00, 'USDC', 'safetrust'),
  ('CAATN5DTEST00003', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', 'GAPPROVER33333333333333333333333333333333333333333333333333', 'GRELEASER3333333333333333333333333333333333333333333333333', 'single_release', 'active', 750.00, 750.00, 'USDC', 'safetrust');
