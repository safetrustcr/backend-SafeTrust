-- Create table for tracking processed webhook events
CREATE TABLE IF NOT EXISTS webhook_processed_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for fast lookups by event_id
CREATE UNIQUE INDEX IF NOT EXISTS webhook_processed_events_event_id_idx ON webhook_processed_events (event_id);

-- Add column for webhook_status to escrow_transactions if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'escrow_transactions' AND column_name = 'webhook_status'
  ) THEN
    ALTER TABLE escrow_transactions ADD COLUMN webhook_status TEXT;
  END IF;
END $$;

-- Add column for webhook_attempts to escrow_transactions if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'escrow_transactions' AND column_name = 'webhook_attempts'
  ) THEN
    ALTER TABLE escrow_transactions ADD COLUMN webhook_attempts INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add column for last_webhook_attempt to escrow_transactions if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'escrow_transactions' AND column_name = 'last_webhook_attempt'
  ) THEN
    ALTER TABLE escrow_transactions ADD COLUMN last_webhook_attempt TIMESTAMPTZ;
  END IF;
END $$; 