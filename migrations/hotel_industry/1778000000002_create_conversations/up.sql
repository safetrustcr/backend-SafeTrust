-- migrations/hotel_industry/1778000000002_create_conversations/up.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.conversations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id        UUID NOT NULL
                          REFERENCES hotel_industry.reservations(id) ON DELETE CASCADE,
  host_id               UUID NOT NULL
                          REFERENCES hotel_industry.users(id) ON DELETE CASCADE,
  guest_id              UUID NOT NULL
                          REFERENCES hotel_industry.users(id) ON DELETE CASCADE,
  escrow_transaction_id UUID,
  status                VARCHAR(50) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived', 'blocked')),
  last_message_at       TIMESTAMP WITH TIME ZONE,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_hotel_conversation  UNIQUE (reservation_id, host_id, guest_id),
  CONSTRAINT hotel_host_guest_different CHECK (host_id != guest_id)
);

CREATE INDEX IF NOT EXISTS idx_hotel_conversations_host
  ON hotel_industry.conversations(host_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_hotel_conversations_guest
  ON hotel_industry.conversations(guest_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_hotel_conversations_reservation
  ON hotel_industry.conversations(reservation_id);

CREATE INDEX IF NOT EXISTS idx_hotel_conversations_escrow
  ON hotel_industry.conversations(escrow_transaction_id)
  WHERE escrow_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION hotel_industry.update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE hotel_industry.conversations
  SET last_message_at = CASE
        WHEN last_message_at IS NULL OR NEW.created_at > last_message_at
          THEN NEW.created_at
        ELSE last_message_at
      END,
      updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;