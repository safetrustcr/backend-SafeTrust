DROP TRIGGER IF EXISTS hotel_conversations_update_last_message ON public.messages;
DROP FUNCTION IF EXISTS public.update_hotel_conversation_last_message();
DROP TABLE IF EXISTS public.messages CASCADE;
