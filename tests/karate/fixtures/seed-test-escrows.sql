-- Seed test escrows for POST /api/escrows/initialize tests
-- Inserts a pre-existing row into trustless_work_escrows so the
-- duplicate contract_id scenario has something to conflict with.
DELETE FROM public.trustless_work_escrows
WHERE contract_id IN ('escrow-created-001');

INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  asset_code,
  tenant_id
) VALUES (
  'escrow-created-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GAPPROVER111WALLETADDRESS111111111111111111111111111111111',
  'GRELEASER111WALLETADDRESS111111111111111111111111111111111',
  'single_release',
  'created',
  1000.0000000,
  'USDC',
  'safetrust'
);
