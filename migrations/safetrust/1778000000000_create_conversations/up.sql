-- ============================================================================
-- conversations: one thread per apartment per host-guest pair.
-- Linked to trustless_work_escrows so escrow lifecycle events can be
-- associated with the correct conversation thread automatically.
-- ============================================================================
CREATE TABLE public.conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apartment_id      UUID NOT NULL REFERENCES public.apartments(id) ON DELETE CASCADE,
  host_id           TEXT NOT NULL REFERENCES public.users(id),
  guest_id          TEXT NOT NULL REFERENCES public.users(id),
  -- Optional escrow link — set when booking moves to funded status
  escrow_id         UUID REFERENCES public.trustless_work_escrows(id) ON DELETE SET NULL,
  status            VARCHAR(50) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived', 'blocked')),
  -- Denormalised for efficient inbox sort — updated by trigger on message INSERT
  last_message_at   TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id         VARCHAR(255) NOT NULL DEFAULT 'safetrust',
  -- One conversation per apartment per host-guest pair
  CONSTRAINT unique_conversation UNIQUE (apartment_id, host_id, guest_id),
  CONSTRAINT host_guest_different CHECK (host_id != guest_id)
);

CREATE INDEX idx_conversations_host
  ON public.conversations(host_id, last_message_at DESC);
CREATE INDEX idx_conversations_guest
  ON public.conversations(guest_id, last_message_at DESC);
CREATE INDEX idx_conversations_apartment
  ON public.conversations(apartment_id);
CREATE INDEX idx_conversations_escrow
  ON public.conversations(escrow_id)
  WHERE escrow_id IS NOT NULL;

-- Auto-update last_message_at when a new message is inserted
CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS TRIGGER AS $$ BEGIN   UPDATE public.conversations   SET last_message_at = NEW.created_at,       updated_at = NOW()   WHERE id = NEW.conversation_id;   RETURN NEW; END; $$ LANGUAGE plpgsql;

COMMENT ON TABLE public.conversations IS
  'One thread per apartment per host-guest pair. Links to escrow for lifecycle messaging.';
COMMENT ON COLUMN public.conversations.escrow_id IS
  'Set when booking is confirmed and escrow is funded — enables automated lifecycle messages.';
COMMENT ON COLUMN public.conversations.last_message_at IS
  'Denormalised from messages — updated by trigger for efficient inbox ordering.';
