DROP TRIGGER IF EXISTS conversations_update_last_message ON public.messages;
DROP FUNCTION IF EXISTS public.update_conversation_last_message();
DROP TABLE IF EXISTS public.conversations;
