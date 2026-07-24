INSERT INTO public.trustless_work_escrows
  (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id)
SELECT
  'CTEST_CHUNK_' || LPAD(i::text, 3, '0'),
  'GMARKER', 'GAPPROVER', 'GRELEASER',
  'single_release', 'created', 'USDC', 100, 'safetrust'
FROM generate_series(1, 51) AS s(i)
ON CONFLICT (contract_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
