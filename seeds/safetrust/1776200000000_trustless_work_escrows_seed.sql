-- Seeds trustless_work_escrows and escrow_milestones
-- Uses contract IDs matching _trustless_work_webhook_events.sql
-- Safe to re-run: DELETE guards on all inserts

DELETE FROM public.escrow_milestones
  WHERE escrow_id IN (
    SELECT id FROM public.trustless_work_escrows
    WHERE contract_id IN (
      'CAATN5DTEST00001','CAATN5DTEST00002','CAATN5DTEST00003'
    )
  );

DELETE FROM public.trustless_work_escrows
  WHERE contract_id IN (
    'CAATN5DTEST00001','CAATN5DTEST00002','CAATN5DTEST00003'
  );

-- Contract 1: milestone_approved (matches escrow.created + milestone.approved events)
INSERT INTO public.trustless_work_escrows (
  contract_id, marker, approver, releaser,
  escrow_type, status, asset_code, amount, balance, tenant_id
) VALUES (
  'CAATN5DTEST00001',
  'GAWVVSATEST0001PROVIDER',
  'GAWVVSATEST0001APPROVER',
  'GAWVVSATEST0001RELEASER',
  'single_release', 'milestone_approved',
  'USDC', 150.00, 150.00, 'safetrust'
);

-- Contract 2: funded (matches escrow.funded event)
INSERT INTO public.trustless_work_escrows (
  contract_id, marker, approver, releaser,
  escrow_type, status, asset_code, amount, balance, tenant_id
) VALUES (
  'CAATN5DTEST00002',
  'GAWVVSATEST0002PROVIDER',
  'GAWVVSATEST0002APPROVER',
  'GAWVVSATEST0002RELEASER',
  'single_release', 'funded',
  'USDC', 300.00, 300.00, 'safetrust'
);

-- Contract 3: completed (matches escrow.completed + escrow.cancelled events)
INSERT INTO public.trustless_work_escrows (
  contract_id, marker, approver, releaser,
  escrow_type, status, asset_code, amount, balance, tenant_id
) VALUES (
  'CAATN5DTEST00003',
  'GAWVVSATEST0003PROVIDER',
  'GAWVVSATEST0003APPROVER',
  'GAWVVSATEST0003RELEASER',
  'single_release', 'completed',
  'USDC', 200.00, 0.00, 'safetrust'
);

-- Milestone for CAATN5DTEST00001 (status: milestone_approved)
INSERT INTO public.escrow_milestones (
  escrow_id, milestone_id, description,
  amount, status, approved_by, approved_at, tenant_id
)
SELECT
  id, 'check_in',
  'Check-in milestone for rental period',
  150.00, 'approved',
  'GAWVVSATEST0001APPROVER',
  NOW() - INTERVAL '2 days',
  'safetrust'
FROM public.trustless_work_escrows
WHERE contract_id = 'CAATN5DTEST00001'
ON CONFLICT (escrow_id, milestone_id) DO NOTHING;
