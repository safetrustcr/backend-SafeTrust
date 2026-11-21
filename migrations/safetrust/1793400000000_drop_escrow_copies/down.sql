-- Rollback for 1793400000000_drop_escrow_copies.
-- Restores the dropped columns and re-derives the copies from the current
-- source of truth:
--   escrow_transactions.contract_id/amount/balance/ledger_seq/network
--     <- trustless_work_escrows through escrow_id
--   escrow_transactions.property_id
--     <- reservations.apartment_id through reservations.escrow_id, then
--        trustless_work_escrows.apartment_id, then contract_id
--   trustless_work_escrows booking columns
--     <- safetrust.reservations through reservations.escrow_id
-- room_id/hotel_id are hotel-tenant values with no safetrust reservation
-- equivalent, so the restored columns stay NULL.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
  ) THEN
    RAISE NOTICE 'safetrust.escrow_transactions not found; nothing to roll back';
    RETURN;
  END IF;

  ALTER TABLE safetrust.escrow_transactions
    ADD COLUMN IF NOT EXISTS contract_id TEXT,
    ADD COLUMN IF NOT EXISTS property_id TEXT,
    ADD COLUMN IF NOT EXISTS amount NUMERIC(20, 7),
    ADD COLUMN IF NOT EXISTS balance NUMERIC(20, 7) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ledger_seq BIGINT NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS network TEXT NULL;

  UPDATE safetrust.escrow_transactions et
  SET contract_id = e.contract_id,
      amount = e.amount,
      balance = e.balance,
      ledger_seq = e.ledger_seq,
      network = e.network,
      -- property_id was NOT NULL before the drop: prefer the reservation,
      -- then the escrow's own apartment_id, then its contract identity.
      property_id = COALESCE(r.apartment_id::text, e.apartment_id::text, e.contract_id)
  FROM safetrust.trustless_work_escrows e
  LEFT JOIN safetrust.reservations r ON r.escrow_id = e.id
  WHERE et.escrow_id = e.id;

  ALTER TABLE safetrust.escrow_transactions
    ALTER COLUMN contract_id SET NOT NULL;
  ALTER TABLE safetrust.escrow_transactions
    ALTER COLUMN property_id SET NOT NULL;
  ALTER TABLE safetrust.escrow_transactions
    ALTER COLUMN amount SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'escrow_transactions_amount_check'
      AND conrelid = 'safetrust.escrow_transactions'::regclass
  ) THEN
    ALTER TABLE safetrust.escrow_transactions
      ADD CONSTRAINT escrow_transactions_amount_check CHECK (amount > 0);
  END IF;

  CREATE INDEX IF NOT EXISTS idx_escrow_transactions_contract_id
    ON safetrust.escrow_transactions (contract_id);
  CREATE INDEX IF NOT EXISTS idx_escrow_transactions_property_id
    ON safetrust.escrow_transactions (property_id);
  CREATE INDEX IF NOT EXISTS idx_escrow_transactions_ledger_seq
    ON safetrust.escrow_transactions (ledger_seq);

  ALTER TABLE safetrust.trustless_work_escrows
    ADD COLUMN IF NOT EXISTS booking_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS room_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS hotel_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS guest_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS check_in_date TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS check_out_date TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS booking_created_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS booking_metadata JSONB;

  UPDATE safetrust.trustless_work_escrows e
  SET booking_id = r.id::text,
      guest_id = r.guest_id,
      check_in_date = r.check_in_date,
      check_out_date = r.check_out_date,
      booking_created_at = r.created_at,
      booking_metadata = jsonb_build_object('reservation_id', r.id)
  FROM safetrust.reservations r
  WHERE r.escrow_id = e.id;

  CREATE INDEX IF NOT EXISTS idx_trustless_escrows_booking_id
    ON safetrust.trustless_work_escrows(booking_id);
  CREATE INDEX IF NOT EXISTS idx_trustless_escrows_hotel_id
    ON safetrust.trustless_work_escrows(hotel_id);
  CREATE INDEX IF NOT EXISTS idx_trustless_escrows_guest_id
    ON safetrust.trustless_work_escrows(guest_id);
END $$;
