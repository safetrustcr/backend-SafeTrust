-- Down migration: revert escrow_id, kind, and status constraint changes on escrow_transactions

-- 1. Drop the new transaction status constraint before converting statuses back
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS valid_escrow_tx_status;

-- 2. Restore legacy fields and escrow status from canonical trustless_work_escrows & reservations
--    Derive legacy-representable statuses from parent before dropping escrow_id
UPDATE safetrust.escrow_transactions et
SET
  status = CASE
    WHEN twe.status IN ('deploying', 'pending_funding', 'funded', 'completed', 'disputed', 'resolved', 'cancelled') THEN twe.status
    WHEN et.status = 'pending_signature' THEN 'pending_signature'
    WHEN et.status = 'submitted' THEN 'deploying'
    WHEN et.status = 'failed' THEN 'cancelled'
    ELSE COALESCE(twe.status, 'funded')
  END,
  contract_id = COALESCE(et.contract_id, twe.contract_id),
  sender_address = COALESCE(et.sender_address, twe.approver),
  receiver_address = COALESCE(et.receiver_address, twe.marker),
  amount = COALESCE(et.amount, twe.amount, 0),
  balance = COALESCE(et.balance, twe.balance, 0),
  ledger_seq = COALESCE(et.ledger_seq, twe.ledger_seq),
  network = COALESCE(et.network, twe.network),
  engagement_id = COALESCE(et.engagement_id, (twe.escrow_metadata->>'engagement_id'), 'eng_' || et.id::text),
  property_id = COALESCE(et.property_id, r.apartment_id::text, 'unknown')
FROM safetrust.trustless_work_escrows twe
LEFT JOIN safetrust.reservations r ON r.escrow_id = twe.id
WHERE et.escrow_id = twe.id;

-- Fallback status for any transaction without a matching parent escrow
UPDATE safetrust.escrow_transactions
SET status = CASE
  WHEN status = 'pending_signature' THEN 'pending_signature'
  WHEN status = 'submitted' THEN 'deploying'
  WHEN status = 'confirmed' THEN 'funded'
  WHEN status = 'failed' THEN 'cancelled'
  ELSE 'pending_signature'
END
WHERE status NOT IN ('deploying', 'pending_funding', 'funded', 'completed', 'disputed', 'resolved', 'cancelled');

-- 3. Restore legacy valid_escrow_status CHECK constraint
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS valid_escrow_status;

ALTER TABLE safetrust.escrow_transactions
  ADD CONSTRAINT valid_escrow_status
  CHECK (status IN (
    'deploying', 'pending_signature', 'funded', 'completed', 'disputed', 'resolved', 'cancelled'
  ));

-- 4. Drop FK constraint and indexes
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS fk_escrow_transactions_escrow_id;

DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_escrow_id;
DROP INDEX IF EXISTS safetrust.uq_escrow_transactions_escrow_kind_tx;

-- 5. Drop columns escrow_id and kind
ALTER TABLE safetrust.escrow_transactions
  DROP CONSTRAINT IF EXISTS valid_transaction_kind;

ALTER TABLE safetrust.escrow_transactions
  DROP COLUMN IF EXISTS kind;

ALTER TABLE safetrust.escrow_transactions
  DROP COLUMN IF EXISTS escrow_id;

-- 6. Restore NOT NULL constraints on legacy columns
UPDATE safetrust.escrow_transactions SET contract_id = 'unknown' WHERE contract_id IS NULL;
UPDATE safetrust.escrow_transactions SET engagement_id = 'unknown_' || id::text WHERE engagement_id IS NULL;
UPDATE safetrust.escrow_transactions SET property_id = 'unknown' WHERE property_id IS NULL;
UPDATE safetrust.escrow_transactions SET sender_address = 'unknown' WHERE sender_address IS NULL;
UPDATE safetrust.escrow_transactions SET receiver_address = 'unknown' WHERE receiver_address IS NULL;
UPDATE safetrust.escrow_transactions SET amount = 0 WHERE amount IS NULL;

ALTER TABLE safetrust.escrow_transactions
  ALTER COLUMN contract_id SET NOT NULL,
  ALTER COLUMN engagement_id SET NOT NULL,
  ALTER COLUMN property_id SET NOT NULL,
  ALTER COLUMN sender_address SET NOT NULL,
  ALTER COLUMN receiver_address SET NOT NULL,
  ALTER COLUMN amount SET NOT NULL;
