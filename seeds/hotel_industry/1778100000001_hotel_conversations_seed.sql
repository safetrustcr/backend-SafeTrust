-- ============================================================================
-- Seed data for host-guest conversations and messages (hotel_industry tenant)
-- Covers pre-booking inquiry and active booking with automated escrow events.
-- Idempotent using ON CONFLICT (id) DO NOTHING.
-- ============================================================================

DO $$
DECLARE
  v_host_id TEXT;
  v_guest_id TEXT;
  v_apartment_id UUID;
  v_escrow_id UUID;
  v_conv1_id UUID := '11111111-1111-4111-8111-111111111111';
  v_conv2_id UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  -- Retrieve host & guest users
  SELECT id INTO v_host_id FROM users WHERE email LIKE '%owner%' OR email LIKE '%host%' OR email LIKE '%admin%' LIMIT 1;
  IF v_host_id IS NULL THEN
    SELECT id INTO v_host_id FROM users LIMIT 1;
  END IF;

  SELECT id INTO v_guest_id FROM users WHERE id != v_host_id LIMIT 1;

  -- Retrieve existing apartment or hotel
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'apartments') THEN
    SELECT id INTO v_apartment_id FROM apartments LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hotels') THEN
    SELECT id INTO v_apartment_id FROM hotels LIMIT 1;
  END IF;

  -- Retrieve existing escrow_transaction or trustless_work_escrow
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'escrow_transactions') THEN
    SELECT id INTO v_escrow_id FROM escrow_transactions LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trustless_work_escrows') THEN
    SELECT id INTO v_escrow_id FROM trustless_work_escrows LIMIT 1;
  END IF;

  IF v_host_id IS NOT NULL AND v_guest_id IS NOT NULL THEN

    -- Conversation 1: Pre-booking inquiry
    INSERT INTO conversations (id, apartment_id, host_id, guest_id, status)
    VALUES (v_conv1_id, v_apartment_id, v_host_id, v_guest_id, 'active')
    ON CONFLICT (id) DO NOTHING;

    -- Messages for Conversation 1 (2 messages: Guest inquiry + Host response)
    INSERT INTO messages (id, conversation_id, sender_id, body, is_automated, event_type, created_at)
    VALUES 
      ('11111111-1111-4111-8111-111111111101', v_conv1_id, v_guest_id, 'Is the room available?', false, NULL, NOW() - INTERVAL '2 hours'),
      ('11111111-1111-4111-8111-111111111102', v_conv1_id, v_host_id, 'Yes, we use SafeTrust escrow for secure payment on Stellar.', false, NULL, NOW() - INTERVAL '1 hour')
    ON CONFLICT (id) DO NOTHING;

    -- Conversation 2: Active booking linked to escrow
    INSERT INTO conversations (id, apartment_id, host_id, guest_id, escrow_id, status)
    VALUES (v_conv2_id, v_apartment_id, v_host_id, v_guest_id, v_escrow_id, 'active')
    ON CONFLICT (id) DO NOTHING;

    -- Messages for Conversation 2 (4 messages: automated escrow deposit + manual host/guest chat + automated check-in reminder)
    INSERT INTO messages (id, conversation_id, sender_id, body, is_automated, event_type, created_at)
    VALUES
      ('22222222-2222-4222-8222-222222222201', v_conv2_id, v_host_id, 'SafeTrust: Your deposit has been confirmed on Stellar. Booking secured.', true, 'escrow_funded', NOW() - INTERVAL '45 minutes'),
      ('22222222-2222-4222-8222-222222222202', v_conv2_id, v_host_id, 'Welcome! Your room will be ready at 3pm.', false, NULL, NOW() - INTERVAL '30 minutes'),
      ('22222222-2222-4222-8222-222222222203', v_conv2_id, v_guest_id, 'Perfect, we arrive around 4pm.', false, NULL, NOW() - INTERVAL '15 minutes'),
      ('22222222-2222-4222-8222-222222222204', v_conv2_id, v_host_id, 'SafeTrust: Check-in reminder — 24 hours until check-in date.', true, 'check_in_reminder', NOW())
    ON CONFLICT (id) DO NOTHING;

  END IF;
END $$;
