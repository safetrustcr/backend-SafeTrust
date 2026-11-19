-- ============================================================================
-- Seed conversations and messages for local development and the SCF demo.
-- Depends on: user, apartments, and trustless_work_escrows seeds.
-- Idempotent: delete the demo threads before inserting them again.
-- ============================================================================

DELETE FROM safetrust.messages
WHERE conversation_id IN (
  SELECT id
  FROM safetrust.conversations
  WHERE tenant_id = 'safetrust'
    AND apartment_id IN (
      '550e8400-e29b-41d4-a716-446655440001'::uuid,
      '550e8400-e29b-41d4-a716-446655440002'::uuid
    )
    AND id IN (
      '00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000002'::uuid
    )
);

DELETE FROM safetrust.conversations
WHERE tenant_id = 'safetrust'
  AND apartment_id IN (
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440002'::uuid
  )
  AND id IN (
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000002'::uuid
  );

-- Conversation 1: pre-booking inquiry (no escrow yet).
INSERT INTO safetrust.conversations (
  id,
  apartment_id,
  host_id,
  guest_id,
  status,
  tenant_id
) VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'demo-owner-uid-002',
  'demo-tenant-uid-001',
  'active',
  'safetrust'
)
ON CONFLICT DO NOTHING;

INSERT INTO safetrust.messages (
  conversation_id,
  sender_id,
  body,
  is_automated,
  read_at,
  tenant_id
) VALUES
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'demo-tenant-uid-001',
    'Hola, me interesa el apartamento. ¿Está disponible a partir del 1 de agosto?',
    false,
    NOW() - INTERVAL '2 hours',
    'safetrust'
  ),
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'demo-owner-uid-002',
    'Hola! Sí, está disponible desde el 1 de agosto. El depósito es de $2,400 USDC via SafeTrust escrow.',
    false,
    NOW() - INTERVAL '1 hour',
    'safetrust'
  ),
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'demo-tenant-uid-001',
    'Perfecto, voy a proceder con la reserva.',
    false,
    NULL,
    'safetrust'
  );

-- Conversation 2: active booking with escrow lifecycle messages.
INSERT INTO safetrust.conversations (
  id,
  apartment_id,
  host_id,
  guest_id,
  escrow_id,
  status,
  tenant_id
)
SELECT
  '00000000-0000-4000-8000-000000000002'::uuid,
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  'demo-owner-uid-002',
  'demo-tenant-uid-001',
  twe.id,
  'active',
  'safetrust'
FROM safetrust.trustless_work_escrows AS twe
WHERE twe.contract_id = 'CAATN5DTEST00002'
  AND twe.tenant_id = 'safetrust';

INSERT INTO safetrust.messages (
  conversation_id,
  sender_id,
  body,
  is_automated,
  event_type,
  read_at,
  tenant_id
) VALUES
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    'demo-tenant-uid-001',
    'SafeTrust: Your escrow contract has been deployed on Stellar. Please fund your deposit to confirm the booking.',
    true,
    'booking_confirmed',
    NOW() - INTERVAL '3 days',
    'safetrust'
  ),
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    'demo-tenant-uid-001',
    'SafeTrust: Your deposit of $950 USDC has been received and locked in escrow on the Stellar network. Your booking is confirmed.',
    true,
    'escrow_funded',
    NOW() - INTERVAL '2 days',
    'safetrust'
  ),
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    'demo-owner-uid-002',
    '¡Bienvenido! El apartamento estará listo para el check-in. Te envío las instrucciones de acceso 24h antes.',
    false,
    NULL,
    NULL,
    'safetrust'
  ),
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    'demo-tenant-uid-001',
    'Gracias! Llegamos mañana alrededor de las 3pm.',
    false,
    NULL,
    NULL,
    'safetrust'
  );
