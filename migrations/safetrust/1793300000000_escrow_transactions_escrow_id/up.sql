-- ============================================================
-- Migration: escrow_transactions.escrow_id (release 1 of 2)
-- ============================================================
-- trustless_work_escrows becomes the single source of truth for escrow
-- state. escrow_transactions becomes the list of transactions signed for an
-- escrow and references it through escrow_id.
--
-- Release order (do not collapse these steps):
--   1. 1793300000000 (this migration): add escrow_id + kind, backfill by
--      contract_id, quarantine unmatched rows. Copied columns stay.
--   2. Application release that writes status/balance/ledger freshness only to
--      trustless_work_escrows.
--   3. 1793400000000_drop_escrow_copies (next release): drop the copies.
--
-- Backfill:
--   escrow_transactions.contract_id  = trustless_work_escrows.contract_id
--
-- Unmatched rows: a transaction whose contract_id has no escrow is moved to
-- safetrust.escrow_transactions_unmatched (whole row preserved) instead of
-- being deleted or attached to a fabricated escrow. This keeps the NOT NULL
-- foreign key honest and leaves the row available for manual reconciliation.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
  ) THEN
    RAISE NOTICE 'safetrust.escrow_transactions not found; skipping escrow_id backfill';
    RETURN;
  END IF;

  -- 1. Quarantine table for transactions without a matching escrow.
  CREATE TABLE IF NOT EXISTS safetrust.escrow_transactions_unmatched
    (LIKE safetrust.escrow_transactions INCLUDING DEFAULTS);

  ALTER TABLE safetrust.escrow_transactions_unmatched
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE safetrust.escrow_transactions_unmatched
    ADD COLUMN IF NOT EXISTS archived_reason TEXT NOT NULL
    DEFAULT 'no trustless_work_escrows.contract_id match';

  INSERT INTO safetrust.escrow_transactions_unmatched (
    id, contract_id, engagement_id, property_id,
    sender_address, receiver_address, amount, status, unsigned_xdr,
    created_at, updated_at, tenant_id,
    ledger_seq, balance, network, tx_hash,
    archived_reason
  )
  SELECT
    et.id, et.contract_id, et.engagement_id, et.property_id,
    et.sender_address, et.receiver_address, et.amount, et.status, et.unsigned_xdr,
    et.created_at, et.updated_at, et.tenant_id,
    et.ledger_seq, et.balance, et.network, et.tx_hash,
    'no trustless_work_escrows.contract_id match'
  FROM safetrust.escrow_transactions et
  WHERE NOT EXISTS (
    SELECT 1
    FROM safetrust.trustless_work_escrows e
    WHERE e.contract_id = et.contract_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM safetrust.escrow_transactions_unmatched a
    WHERE a.id = et.id
  );

  DELETE FROM safetrust.escrow_transactions et
  WHERE NOT EXISTS (
    SELECT 1
    FROM safetrust.trustless_work_escrows e
    WHERE e.contract_id = et.contract_id
  );

  -- 2. Add the reference and the transaction kind.
  ALTER TABLE safetrust.escrow_transactions
    ADD COLUMN IF NOT EXISTS escrow_id UUID;
  ALTER TABLE safetrust.escrow_transactions
    ADD COLUMN IF NOT EXISTS kind TEXT;

  -- 3. Backfill escrow_id through contract_id.
  UPDATE safetrust.escrow_transactions et
  SET escrow_id = e.id
  FROM safetrust.trustless_work_escrows e
  WHERE et.escrow_id IS NULL
    AND e.contract_id = et.contract_id;

  -- 4. Fold ledger freshness that existed only on the transaction row into
  --    the escrow. Only fills gaps: an escrow ledger_seq already present wins,
  --    and status/balance are never rewritten here.
  UPDATE safetrust.trustless_work_escrows e
  SET ledger_seq = et.ledger_seq,
      network = COALESCE(NULLIF(TRIM(e.network), ''), NULLIF(TRIM(et.network), '')),
      updated_at = NOW()
  FROM safetrust.escrow_transactions et
  WHERE et.escrow_id = e.id
    AND e.ledger_seq IS NULL
    AND et.ledger_seq IS NOT NULL;

  -- 5. Backfill kind from the legacy status. Before this migration a row
  --    represented the escrow ledger entry itself, so:
  --      funded / completed / disputed / resolved -> 'fund'
  --      deploying / pending_signature / cancelled -> 'deploy'
  UPDATE safetrust.escrow_transactions
  SET kind = CASE
    WHEN status IN ('funded', 'completed', 'disputed', 'resolved') THEN 'fund'
    ELSE 'deploy'
  END
  WHERE kind IS NULL;

  ALTER TABLE safetrust.escrow_transactions
    ALTER COLUMN kind SET DEFAULT 'deploy';
  ALTER TABLE safetrust.escrow_transactions
    ALTER COLUMN kind SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'escrow_transactions_kind_check'
      AND conrelid = 'safetrust.escrow_transactions'::regclass
  ) THEN
    ALTER TABLE safetrust.escrow_transactions
      ADD CONSTRAINT escrow_transactions_kind_check
      CHECK (kind IN ('deploy', 'fund', 'approve', 'release'));
  END IF;

  -- 6. Enforce the reference.
  ALTER TABLE safetrust.escrow_transactions
    ALTER COLUMN escrow_id SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'escrow_transactions_escrow_id_fkey'
      AND conrelid = 'safetrust.escrow_transactions'::regclass
  ) THEN
    ALTER TABLE safetrust.escrow_transactions
      ADD CONSTRAINT escrow_transactions_escrow_id_fkey
      FOREIGN KEY (escrow_id)
      REFERENCES safetrust.trustless_work_escrows(id)
      ON DELETE CASCADE;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_escrow_transactions_escrow_id
    ON safetrust.escrow_transactions (escrow_id);

  -- One transaction row per (escrow, kind, tx_hash); NULL tx_hash values stay
  -- distinct, so unsigned/pending rows are unaffected.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_transactions_escrow_kind_tx
    ON safetrust.escrow_transactions (escrow_id, kind, tx_hash);
END $$;

COMMENT ON COLUMN safetrust.escrow_transactions.escrow_id
  IS 'Escrow this transaction was signed for (trustless_work_escrows.id)';
COMMENT ON COLUMN safetrust.escrow_transactions.kind
  IS 'Transaction kind: deploy | fund | approve | release';
COMMENT ON TABLE safetrust.escrow_transactions_unmatched
  IS 'Quarantined escrow_transactions rows with no matching trustless_work_escrows.contract_id; preserved for manual reconciliation';
