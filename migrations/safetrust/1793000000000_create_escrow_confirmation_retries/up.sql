-- ============================================================================
-- Migration: Create Escrow Confirmation Retries Table & Track Tx Hash/Network
-- Description: Supports durable transaction confirmation, retry mechanism,
--              and dual submission paths (helper vs external) with DLQ support.
-- ============================================================================

CREATE TABLE IF NOT EXISTS safetrust.escrow_confirmation_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash VARCHAR(64) NOT NULL,
  escrow_id VARCHAR(255) NOT NULL,
  escrow_action VARCHAR(50) NOT NULL,
  network VARCHAR(20) NOT NULL DEFAULT 'testnet',
  submission_path VARCHAR(20) NOT NULL DEFAULT 'external',
  status VARCHAR(20) NOT NULL DEFAULT 'retrying',
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  CONSTRAINT valid_escrow_action CHECK (escrow_action IN ('deploy', 'fund')),
  CONSTRAINT valid_network CHECK (network IN ('testnet', 'mainnet')),
  CONSTRAINT valid_submission_path CHECK (submission_path IN ('helper', 'external')),
  CONSTRAINT valid_retry_status CHECK (status IN ('retrying', 'dead_letter', 'completed')),
  CONSTRAINT unique_tx_action UNIQUE (tx_hash, escrow_action)
);

CREATE INDEX IF NOT EXISTS idx_escrow_retries_pending
  ON safetrust.escrow_confirmation_retries (status, next_retry_at)
  WHERE status = 'retrying';

CREATE INDEX IF NOT EXISTS idx_escrow_retries_tx_hash
  ON safetrust.escrow_confirmation_retries (tx_hash);

CREATE INDEX IF NOT EXISTS idx_escrow_retries_escrow_id
  ON safetrust.escrow_confirmation_retries (escrow_id);

-- Add tx_hash and network to trustless_work_escrows if not present
ALTER TABLE safetrust.trustless_work_escrows
  ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS network VARCHAR(20) DEFAULT 'testnet';

CREATE INDEX IF NOT EXISTS idx_trustless_escrows_tx_hash
  ON safetrust.trustless_work_escrows (tx_hash);

-- Add tx_hash and network to escrow_transactions if not present
ALTER TABLE safetrust.escrow_transactions
  ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS network VARCHAR(20) DEFAULT 'testnet';

CREATE INDEX IF NOT EXISTS idx_escrow_transactions_tx_hash
  ON safetrust.escrow_transactions (tx_hash);
