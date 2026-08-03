DELETE FROM public.reservations
WHERE id IN (
  '11111111-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000002'
);

-- status: pending — no escrow yet (used by POST /api/reservations tests)
INSERT INTO public.reservations (
  id, apartment_id, guest_id,
  check_in_date, check_out_date,
  total_amount, asset_code,
  status, escrow_id, tenant_id
) VALUES (
  '11111111-0000-0000-0000-000000000001',
  (SELECT id FROM public.apartments LIMIT 1),
  'owner-123',
  NOW() + INTERVAL '7 days',
  NOW() + INTERVAL '14 days',
  2500.00, 'USDC',
  'pending', NULL, 'safetrust'
);

-- status: escrow_created — linked to escrow-created-001
INSERT INTO public.reservations (
  id, apartment_id, guest_id,
  check_in_date, check_out_date,
  total_amount, asset_code,
  status, escrow_id, tenant_id
) VALUES (
  '11111111-0000-0000-0000-000000000002',
  (SELECT id FROM public.apartments LIMIT 1),
  'owner-123',
  NOW() + INTERVAL '14 days',
  NOW() + INTERVAL '21 days',
  3200.00, 'USDC',
  'escrow_created',
  (SELECT id FROM public.trustless_work_escrows WHERE contract_id = 'escrow-funded-001'),
  'safetrust'
);