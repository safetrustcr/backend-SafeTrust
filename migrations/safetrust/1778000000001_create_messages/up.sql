-- ============================================================================
-- messages: individual messages within a conversation.
-- Supports both manual messages (is_automated = false) and automated
-- escrow lifecycle notifications (is_automated = true, event_type set).
--
-- Automated event_type values (for reference):
--   'booking_inquiry'       — guest asks host a question pre-booking
--   'booking_confirmed'     — escrow deployed on Stellar
--   'escrow_funded'         — tenant deposit confirmed on Stellar
--   'milestone_approved'    — service provider marks milestone complete
--   'funds_released'        — escrow released to owner
--   'dispute_opened'        — escrow disputed
--   'dispute_resolved'      — dispute resolved
--   'check_in_reminder'     — automated 24h before available_from date
--   'checkout_reminder'     — automated 24h before available_until date
-- ============================================================================
CREATE TABLE public.messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id         TEXT NOT NULL REFERENCES public.users(id),
  body              TEXT NOT NULL
                      CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 4000),
  -- Automated message metadata
  is_automated      BOOLEAN NOT NULL DEFAULT false,
  event_type        VARCHAR(100),
  -- Read tracking: NULL = unread, timestamp = when it was read
  read_at           TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  tenant_id         VARCHAR(255) NOT NULL DEFAULT 'safetrust',
  -- event_type only valid on automated messages and restricted to valid lifecycle events
  CONSTRAINT event_type_requires_automated
    CHECK (
      (is_automated = false AND event_type IS NULL) OR
      (is_automated = true AND event_type IS NOT NULL AND event_type IN (
        'booking_inquiry',
        'booking_confirmed',
        'escrow_funded',
        'milestone_approved',
        'funds_released',
        'dispute_opened',
        'dispute_resolved',
        'check_in_reminder',
        'checkout_reminder'
      ))
    )
);

-- Primary access pattern: all messages in a conversation, chronological
CREATE INDEX idx_messages_conversation
  ON public.messages(conversation_id, created_at ASC);

-- Unread count per conversation — partial index, small footprint
CREATE INDEX idx_messages_unread
  ON public.messages(conversation_id, sender_id)
  WHERE read_at IS NULL;

-- Automated message lookup — for deduplication and event history
CREATE INDEX idx_messages_event_type
  ON public.messages(conversation_id, event_type)
  WHERE is_automated = true;

CREATE TRIGGER conversations_update_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_last_message();

COMMENT ON TABLE public.messages IS
  'Individual messages within a conversation. Supports manual and automated escrow lifecycle messages.';
COMMENT ON COLUMN public.messages.is_automated IS
  'True for system-generated messages triggered by escrow lifecycle events.';
COMMENT ON COLUMN public.messages.event_type IS
  'Escrow lifecycle event that triggered this message. NULL for manual messages.';
COMMENT ON COLUMN public.messages.read_at IS
  'NULL means unread. Set to NOW() when recipient opens the conversation.';
