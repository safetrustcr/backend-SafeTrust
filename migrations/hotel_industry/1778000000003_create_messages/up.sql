CREATE TABLE IF NOT EXISTS public.messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  UUID NOT NULL
                     REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL
                     REFERENCES public.users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL
                     CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  is_automated     BOOLEAN NOT NULL DEFAULT false,
  event_type       VARCHAR(100),
  read_at          TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT hotel_event_type_requires_automated
    CHECK (event_type IS NULL OR is_automated = true)
);

CREATE INDEX idx_hotel_messages_conversation
  ON public.messages(conversation_id, created_at ASC);

CREATE INDEX idx_hotel_messages_unread
  ON public.messages(conversation_id, sender_id)
  WHERE read_at IS NULL;

CREATE INDEX idx_hotel_messages_event_type
  ON public.messages(conversation_id, event_type)
  WHERE is_automated = true;

CREATE TRIGGER hotel_conversations_update_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_hotel_conversation_last_message();
