-- Preserve the existing trigger dependency while moving its function.
ALTER FUNCTION public.update_conversation_last_message() SET SCHEMA safetrust;

CREATE OR REPLACE FUNCTION safetrust.update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE safetrust.conversations
  SET last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
      updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
