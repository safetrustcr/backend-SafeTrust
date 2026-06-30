-- Seed test escrows for dispute resolution tests
DELETE FROM public.trustless_work_escrows WHERE contract_id IN ('escrow-disputed-001');
INSERT INTO public.trustless_work_escrows (
    contract_id,
    marker,
    approver,
    releaser,
    escrow_type,
    status,
    asset_code,
    amount,
    balance
) VALUES (
    'escrow-disputed-001',
    'GMARKERHOTELWALLET11111111111111111111111111111111111',
    'GAPPROVERGUESTWALLET111111111111111111111111111111111',
    'GRELEASERPLATFORMWALLET1111111111111111111111111111111',
    'single_release',
    'disputed',
    'USDC',
    100.0000000,
    50.0000000
);
