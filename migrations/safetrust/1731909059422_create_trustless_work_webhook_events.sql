CREATE TABLE IF NOT EXISTS public.trustless_work_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  signature VARCHAR(255),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',
  
  
  CONSTRAINT valid_retry_count CHECK (retry_count >= 0),
  CONSTRAINT valid_max_retries CHECK (max_retries >= 0)
);


CREATE INDEX IF NOT EXISTS idx_webhook_events_contract_id ON public.trustless_work_webhook_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON public.trustless_work_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON public.trustless_work_webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON public.trustless_work_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_retry ON public.trustless_work_webhook_events(retry_count, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON public.trustless_work_webhook_events(tenant_id);


COMMENT ON TABLE public.trustless_work_webhook_events IS 'Webhook events from Trustless Work for audit and debugging';
COMMENT ON COLUMN public.trustless_work_webhook_events.event_type IS 'Type of webhook event (escrow.created, milestone.approved, etc.)';
COMMENT ON COLUMN public.trustless_work_webhook_events.signature IS 'HMAC signature for webhook verification';
COMMENT ON COLUMN public.trustless_work_webhook_events.next_retry_at IS 'Timestamp for next retry attempt if processing failed';