-- Seed test escrows
DELETE FROM public.trustless_work_escrows WHERE contract_id = 'escrow-funded-001';

INSERT INTO public.trustless_work_escrows (
    contract_id, marker, approver, releaser, 
    escrow_type, status, amount, balance, tenant_id
) VALUES (
    'escrow-funded-001',
    'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
    'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
    'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
    'single_release',
    'milestone_approved',
    3200.0000000,
    3200.0000000,
    'safetrust'
);
