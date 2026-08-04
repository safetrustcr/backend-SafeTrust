-- migrations/hotel_industry/1778000000003_create_messages/up.sql

CREATE TABLE IF NOT EXISTS hotel_industry.messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   UUID NOT NULL
                      REFERENCES hotel_industry.conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL
                      REFERENCES hotel_industry.users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL
                      CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  is_automated      BOOLEAN NOT NULL DEFAULT false,
  event_type        VARCHAR(100),
  read_at           TIMESTAMP WITH TIME ZONE,
  forwarded_from_id UUID
                      REFERENCES hotel_industry.messages(id) ON DELETE SET NULL,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT hotel_event_type_requires_automated
    CHECK (event_type IS NULL OR is_automated = true)
);

CREATE INDEX IF NOT EXISTS idx_hotel_messages_conversation
  ON hotel_industry.messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_hotel_messages_unread
  ON hotel_industry.messages(conversation_id, sender_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hotel_messages_event_type
  ON hotel_industry.messages(conversation_id, event_type)
  WHERE is_automated = true;

CREATE INDEX IF NOT EXISTS idx_hotel_messages_forwarded
  ON hotel_industry.messages(forwarded_from_id)
  WHERE forwarded_from_id IS NOT NULL;

CREATE TRIGGER hotel_conversations_update_last_message
  AFTER INSERT ON hotel_industry.messages
  FOR EACH ROW EXECUTE FUNCTION hotel_industry.update_conversation_last_message();