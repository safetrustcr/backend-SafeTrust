-- seeds/hotel_industry/1778100000001_hotel_conversations_seed.sql

DO $$
DECLARE
  v_host_id   UUID;
  v_guest_id  UUID;
  v_escrow_id UUID;
  v_conv1_id  UUID := '11111111-1111-4111-8111-111111111111';
  v_conv2_id  UUID := '22222222-2222-4222-8222-222222222222';
  v_res_id    UUID;
BEGIN
  SELECT id INTO v_host_id
    FROM hotel_industry.users
    WHERE email LIKE '%owner%' OR email LIKE '%host%'
    LIMIT 1;
  IF v_host_id IS NULL THEN
    SELECT id INTO v_host_id FROM hotel_industry.users LIMIT 1;
  END IF;

  SELECT id INTO v_guest_id
    FROM hotel_industry.users
    WHERE id != v_host_id
    LIMIT 1;

  SELECT id INTO v_res_id
    FROM hotel_industry.reservations
    LIMIT 1;

  SELECT id INTO v_escrow_id
    FROM hotel_industry.escrow_transactions
    LIMIT 1;

  IF v_host_id IS NOT NULL AND v_guest_id IS NOT NULL AND v_res_id IS NOT NULL THEN

    -- Conversation 1: Pre-booking inquiry
    INSERT INTO hotel_industry.conversations
      (id, reservation_id, host_id, guest_id, status)
    VALUES
      (v_conv1_id, v_res_id, v_host_id, v_guest_id, 'active')
    ON CONFLICT ON CONSTRAINT unique_hotel_conversation DO NOTHING;

    INSERT INTO hotel_industry.messages
      (id, conversation_id, sender_id, body, is_automated, event_type, created_at)
    VALUES
      (
        '11111111-1111-4111-8111-111111111101',
        v_conv1_id, v_guest_id,
        'Is the room available?',
        false, NULL, NOW() - INTERVAL '2 hours'
      ),
      (
        '11111111-1111-4111-8111-111111111102',
        v_conv1_id, v_host_id,
        'Yes, we use SafeTrust escrow for secure payment on Stellar.',
        false, NULL, NOW() - INTERVAL '1 hour'
      )
    ON CONFLICT (id) DO NOTHING;

    -- Conversation 2: Active booking linked to escrow
    -- Uses a different reservation to avoid unique_hotel_conversation collision
    INSERT INTO hotel_industry.conversations
      (id, reservation_id, host_id, guest_id, escrow_transaction_id, status)
    SELECT
      v_conv2_id,
      r.id,
      v_host_id,
      v_guest_id,
      v_escrow_id,
      'active'
    FROM hotel_industry.reservations r
    WHERE r.id != v_res_id
    LIMIT 1
    ON CONFLICT ON CONSTRAINT unique_hotel_conversation DO NOTHING;

    INSERT INTO hotel_industry.messages
      (id, conversation_id, sender_id, body, is_automated, event_type, created_at)
    VALUES
      (
        '22222222-2222-4222-8222-222222222201',
        v_conv2_id, v_host_id,
        'SafeTrust: Your deposit has been confirmed on Stellar. Booking secured.',
        true, 'escrow_funded', NOW() - INTERVAL '45 minutes'
      ),
      (
        '22222222-2222-4222-8222-222222222202',
        v_conv2_id, v_host_id,
        'Welcome! Your room will be ready at 3pm.',
        false, NULL, NOW() - INTERVAL '30 minutes'
      ),
      (
        '22222222-2222-4222-8222-222222222203',
        v_conv2_id, v_guest_id,
        'Perfect, we arrive around 4pm.',
        false, NULL, NOW() - INTERVAL '15 minutes'
      ),
      (
        '22222222-2222-4222-8222-222222222204',
        v_conv2_id, v_host_id,
        'SafeTrust: Check-in reminder — 24 hours until check-in date.',
        true, 'check_in_reminder', NOW()
      )
    ON CONFLICT (id) DO NOTHING;

  END IF;
END $$;