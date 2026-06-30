-- Seed test escrows for Karate tests
DELETE FROM public.trustless_work_escrows WHERE contract_id IN ('escrow-created-001', 'escrow-funded-001');

INSERT INTO public.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  balance,
  tenant_id
) VALUES
(
  'escrow-created-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'single_release',
  'created',
  2500.00,
  0,
  'safetrust'
),
(
  'escrow-funded-001',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
  'single_release',
  'funded',
  2500.00,
  2500.00,
  'safetrust'
);
