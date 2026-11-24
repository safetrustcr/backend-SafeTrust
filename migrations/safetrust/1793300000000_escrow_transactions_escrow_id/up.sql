-- Migration: Add escrow_id and kind to escrow_transactions, backfill from trustless_work_escrows
-- Release: 1 of 2 (Expand and migrate write paths)
--
-- Description:
--   Establishes trustless_work_escrows as the canonical source of truth for escrow state.
--   escrow_transactions becomes an append/audit log of signed transactions referencing
--   the parent escrow via escrow_id.
--
-- Column Mappings (escrow_transactions -> trustless_work_escrows / reservations):
--   - receiver_address -> trustless_work_escrows.marker (property host/owner wallet receiving funds)
--   - sender_address   -> trustless_work_escrows.approver & releaser (guest wallet that funds/approves)
--   - engagement_id    -> retained for signing audit & stored in trustless_work_escrows.escrow_metadata
--   - amount           -> trustless_work_escrows.amount
--   - balance          -> trustless_work_escrows.balance
--   - ledger_seq       -> trustless_work_escrows.ledger_seq
--   - network          -> trustless_work_escrows.network
--   - tx_hash          -> trustless_work_escrows.tx_hash
--   - contract_id      -> trustless_work_escrows.contract_id
--   - property_id      -> resolved through safetrust.reservations.apartment_id
--
-- Release Ordering:
--   1. Release 1 (THIS PR): Add escrow_id and kind, backfill references from contract_id,
--      relax NOT NULL on legacy copied columns, update status check constraints,
--      and switch application reads/writes. Status/balance/freshness are written exclusively
--      to trustless_work_escrows.
--   2. Release 2 (Follow-up PR): Execute drop_escrow_copies migration to drop copied columns
--      from escrow_transactions and booking copies from trustless_work_escrows once writes
--      to them have ceased across all instances.

DO $$
BEGIN
  -- 1. Add escrow_id (nullable initially to allow backfill)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions' AND column_name = 'escrow_id'
  ) THEN
    ALTER TABLE safetrust.escrow_transactions
      ADD COLUMN escrow_id UUID;
  END IF;

  -- 2. Add kind column with default
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions' AND column_name = 'kind'
  ) THEN
    ALTER TABLE safetrust.escrow_transactions
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'deploy';
  END IF;
END $$;

-- Add kind CHECK constraint as NOT VALID and validate
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS valid_transaction_kind;

ALTER TABLE safetrust.escrow_transactions
  ADD CONSTRAINT valid_transaction_kind
  CHECK (kind IN ('deploy', 'fund', 'approve', 'release')) NOT VALID;

ALTER TABLE safetrust.escrow_transactions
  VALIDATE CONSTRAINT valid_transaction_kind;

-- 3. Ensure any orphan escrow_transactions row has a matching trustless_work_escrows row
-- Map role columns: receiver_address -> marker (owner), sender_address -> approver (guest)
INSERT INTO safetrust.trustless_work_escrows (
  contract_id,
  marker,
  approver,
  releaser,
  escrow_type,
  status,
  amount,
  balance,
  ledger_seq,
  network,
  tx_hash,
  tenant_id,
  created_at,
  updated_at
)
SELECT DISTINCT ON (et.contract_id)
  et.contract_id,
  et.receiver_address,
  et.sender_address,
  et.sender_address,
  'single_release',
  CASE
    WHEN et.status IN ('created', 'pending_funding', 'funded', 'active', 'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled') THEN et.status
    WHEN et.status = 'pending_signature' THEN 'created'
    WHEN et.status = 'deploying' THEN 'created'
    ELSE 'created'
  END,
  COALESCE(et.amount, 0),
  COALESCE(et.balance, 0),
  et.ledger_seq,
  et.network,
  et.tx_hash,
  COALESCE(et.tenant_id, 'safetrust'),
  et.created_at,
  et.updated_at
FROM safetrust.escrow_transactions et
WHERE et.contract_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM safetrust.trustless_work_escrows twe
    WHERE twe.contract_id = et.contract_id
  )
ORDER BY et.contract_id, et.created_at DESC;

-- 4. Reconcile existing trustless_work_escrows where escrow_transactions has fresher ledger sequence
-- Selects the highest ledger snapshot per contract_id and reconciles status, balance,
-- and freshness together as a consistent snapshot across all supported statuses.
WITH latest_tx AS (
  SELECT DISTINCT ON (contract_id)
    contract_id,
    status,
    balance,
    ledger_seq,
    network,
    tx_hash,
    updated_at
  FROM safetrust.escrow_transactions
  WHERE ledger_seq IS NOT NULL
  ORDER BY contract_id, ledger_seq DESC, updated_at DESC, id DESC
)
UPDATE safetrust.trustless_work_escrows twe
SET
  status = CASE
    WHEN lt.status IN ('created', 'pending_funding', 'funded', 'active', 'milestone_approved', 'completed', 'disputed', 'resolved', 'cancelled') THEN lt.status
    ELSE twe.status
  END,
  balance = COALESCE(lt.balance, twe.balance),
  ledger_seq = lt.ledger_seq,
  network = COALESCE(lt.network, twe.network),
  tx_hash = COALESCE(lt.tx_hash, twe.tx_hash),
  updated_at = GREATEST(twe.updated_at, lt.updated_at)
FROM latest_tx lt
WHERE lt.contract_id = twe.contract_id
  AND (twe.ledger_seq IS NULL OR lt.ledger_seq > twe.ledger_seq);

-- 5. Backfill escrow_id from trustless_work_escrows matching by contract_id
UPDATE safetrust.escrow_transactions et
SET escrow_id = twe.id
FROM safetrust.trustless_work_escrows twe
WHERE et.contract_id = twe.contract_id
  AND et.escrow_id IS NULL;

-- 6. Drop legacy status check constraint BEFORE converting transaction status values
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS valid_escrow_status;

-- Map and update legacy transaction status values to new transaction states:
-- ('pending_signature', 'submitted', 'confirmed', 'failed')
UPDATE safetrust.escrow_transactions
SET status = CASE
  WHEN status = 'pending_signature' THEN 'pending_signature'
  WHEN status = 'deploying' THEN 'submitted'
  WHEN status IN ('funded', 'completed', 'resolved') THEN 'confirmed'
  WHEN status = 'cancelled' THEN 'failed'
  ELSE 'confirmed'
END;

-- 7. Add replacement status CHECK constraint on escrow_transactions
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS valid_escrow_tx_status;

ALTER TABLE safetrust.escrow_transactions
  ADD CONSTRAINT valid_escrow_tx_status
  CHECK (status IN ('pending_signature', 'submitted', 'confirmed', 'failed')) NOT VALID;

ALTER TABLE safetrust.escrow_transactions
  VALIDATE CONSTRAINT valid_escrow_tx_status;

-- 8. Enforce NOT NULL on escrow_id and add foreign key constraint
ALTER TABLE safetrust.escrow_transactions
  ALTER COLUMN escrow_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'safetrust'
      AND table_name = 'escrow_transactions'
      AND constraint_name = 'fk_escrow_transactions_escrow_id'
  ) THEN
    ALTER TABLE safetrust.escrow_transactions
      ADD CONSTRAINT fk_escrow_transactions_escrow_id
      FOREIGN KEY (escrow_id)
      REFERENCES safetrust.trustless_work_escrows(id)
      ON DELETE CASCADE NOT VALID;

    ALTER TABLE safetrust.escrow_transactions
      VALIDATE CONSTRAINT fk_escrow_transactions_escrow_id;
  END IF;
END $$;

-- 9. Create indexes for performance and uniqueness
CREATE INDEX IF NOT EXISTS idx_escrow_transactions_escrow_id
  ON safetrust.escrow_transactions (escrow_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_transactions_escrow_kind_tx
  ON safetrust.escrow_transactions (escrow_id, kind, tx_hash)
  WHERE tx_hash IS NOT NULL;

-- 10. Relax NOT NULL constraints on legacy copied columns so new transaction inserts
--     in Release 1 do not depend on legacy fields before the column drop in Release 2
ALTER TABLE safetrust.escrow_transactions
  ALTER COLUMN contract_id DROP NOT NULL,
  ALTER COLUMN engagement_id DROP NOT NULL,
  ALTER COLUMN property_id DROP NOT NULL,
  ALTER COLUMN sender_address DROP NOT NULL,
  ALTER COLUMN receiver_address DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL;
