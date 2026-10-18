ALTER FUNCTION safetrust.update_conversation_last_message() SET SCHEMA public;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
      updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
