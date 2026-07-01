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
-- Seed test escrows for Trustless Work
DELETE FROM public.escrow_milestones WHERE milestone_id = 'check_in';
DELETE FROM public.trustless_work_escrows WHERE contract_id IN ('escrow-funded-001', 'escrow-pending-002');

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
  resolver,
  escrow_type,
  status,
  asset_code,
  asset_issuer,
  amount,
  balance,
  booking_id,
  room_id,
  hotel_id,
  guest_id,
  check_in_date,
  check_out_date,
  booking_created_at,
  escrow_metadata,
  booking_metadata,
  tenant_id
) VALUES
(
  'escrow-funded-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GXYZ9876543210ZYXWVUTSRQPONMLKJIHGFEDCBA',
  'single_release',
  'funded',
  'USDC',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  100.0000000,
  100.0000000,
  'booking-001',
  'room-101',
  'hotel-001',
  'guest-001',
  NOW() + INTERVAL '1 day',
  NOW() + INTERVAL '3 days',
  NOW(),
  '{"test": "data"}'::jsonb,
  '{"test": "booking"}'::jsonb,
  'safetrust'
),
(
  'escrow-pending-002',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GXYZ9876543210ZYXWVUTSRQPONMLKJIHGFEDCBA',
  'single_release',
  'pending_funding',
  'USDC',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  50.0000000,
  0.0000000,
  'booking-002',
  'room-102',
  'hotel-001',
  'guest-002',
  NOW() + INTERVAL '5 days',
  NOW() + INTERVAL '7 days',
  NOW(),
  '{"test": "data"}'::jsonb,
  '{"test": "booking"}'::jsonb,
  'safetrust'
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
