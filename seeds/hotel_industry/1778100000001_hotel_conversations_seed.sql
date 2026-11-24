-- seeds/hotel_industry/1778100000001_hotel_conversations_seed.sql

DO $$
DECLARE
  v_host_id   UUID;
  v_guest1_id UUID;
  v_guest2_id UUID;
  v_escrow_id UUID;
  v_conv1_id  UUID := '11111111-1111-4111-8111-111111111111';
  v_conv2_id  UUID := '22222222-2222-4222-8222-222222222222';
  v_res1_id   UUID;
  v_res2_id   UUID;
BEGIN
  -- Fixed host: Bob Owner
  SELECT id INTO v_host_id
    FROM hotel_industry.users
    WHERE email = 'bob.owner@example.com';

  -- Fixed reservation 1: Grand Hotel, room 101, check-in 2024-08-15
  SELECT r.id, u.id
    INTO v_res1_id, v_guest1_id
    FROM hotel_industry.reservations r
    JOIN hotel_industry.rooms rm ON rm.room_id = r.room_id
    JOIN hotel_industry.hotels h ON h.id = rm.hotel_id
    JOIN hotel_industry.users_wallets w ON w.wallet_address = r.wallet_address
    JOIN hotel_industry.users u ON u.id = w.user_id
    WHERE h.name = 'Grand Hotel'
      AND rm.room_number = '101'
      AND r.check_in = '2024-08-15 15:00:00+00';

  -- Fixed reservation 2: Grand Hotel, room 101, check-in 2024-08-28
  SELECT r.id, u.id
    INTO v_res2_id, v_guest2_id
    FROM hotel_industry.reservations r
    JOIN hotel_industry.rooms rm ON rm.room_id = r.room_id
    JOIN hotel_industry.hotels h ON h.id = rm.hotel_id
    JOIN hotel_industry.users_wallets w ON w.wallet_address = r.wallet_address
    JOIN hotel_industry.users u ON u.id = w.user_id
    WHERE h.name = 'Grand Hotel'
      AND rm.room_number = '101'
      AND r.check_in = '2024-08-28 15:00:00+00';

  -- Fixed escrow transaction: contract-2 (CONFIRMED)
  SELECT id INTO v_escrow_id
    FROM hotel_industry.escrow_transactions
    WHERE contract_id = 'contract-2';

  IF v_host_id IS NOT NULL AND v_guest1_id IS NOT NULL AND v_res1_id IS NOT NULL THEN

    -- Conversation 1: Pre-booking inquiry
    INSERT INTO hotel_industry.conversations
      (id, reservation_id, host_id, guest_id, status)
    VALUES
      (v_conv1_id, v_res1_id, v_host_id, v_guest1_id, 'active')
    ON CONFLICT ON CONSTRAINT unique_hotel_conversation DO NOTHING;

    INSERT INTO hotel_industry.messages
      (id, conversation_id, sender_id, body, is_automated, event_type, created_at)
    VALUES
      (
        '11111111-1111-4111-8111-111111111101',
        v_conv1_id, v_guest1_id,
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
    IF v_guest2_id IS NOT NULL AND v_res2_id IS NOT NULL AND v_escrow_id IS NOT NULL THEN
      INSERT INTO hotel_industry.conversations
        (id, reservation_id, host_id, guest_id, escrow_transaction_id, status)
      VALUES
        (v_conv2_id, v_res2_id, v_host_id, v_guest2_id, v_escrow_id, 'active')
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
          v_conv2_id, v_guest2_id,
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

  END IF;
END $$;
