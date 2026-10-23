-- status: escrow_created — linked to escrow-created-001
INSERT INTO safetrust.reservations (
  id, apartment_id, guest_id,
  check_in_date, check_out_date,
  total_amount, asset_code,
  status, escrow_id, tenant_id
) VALUES (
  '11111111-0000-0000-0000-000000000002',
  (SELECT id FROM safetrust.apartments LIMIT 1),
  'owner-123',
  NOW() + INTERVAL '14 days',
  NOW() + INTERVAL '21 days',
  3200.00, 'USDC',
  'escrow_created',
  (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = 'escrow-created-001'),
  'safetrust'
);