-- ============================================================
-- Migration: drop escrow copies (release 2 of 2)
-- ============================================================
-- Apply only after the release that stopped writing these columns is running.
-- Do not merge this step into 1793300000000_escrow_transactions_escrow_id:
-- the expand phase (add + backfill) and the contract phase (drop) ship in
-- separate releases so a rollback of the application still has its columns.
--
-- escrow_transactions keeps transaction facts (escrow_id, kind, status,
-- unsigned_xdr, tx_hash) and drops the copies of escrow state:
--   amount, balance, ledger_seq, network, contract_id, property_id
--
-- trustless_work_escrows keeps the escrow and drops the booking copies:
--   booking_id, room_id, hotel_id, guest_id, check_in_date, check_out_date,
--   booking_created_at, booking_metadata
-- Booking reads now join safetrust.reservations through reservations.escrow_id.
--
-- apartment_id is intentionally kept: an escrow can exist without a
-- reservation (initialize accepts no booking_metadata, and hotel-tenant
-- escrows are not safetrust reservations), so it cannot always be read from
-- the reservation.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
  ) THEN
    RAISE NOTICE 'safetrust.escrow_transactions not found; skipping drop';
    RETURN;
  END IF;

  -- Only drop the transaction copies once the reference exists.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'safetrust' AND table_name = 'escrow_transactions'
      AND column_name = 'escrow_id'
  ) THEN
    DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_contract_id;
    DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_property_id;
    DROP INDEX IF EXISTS safetrust.idx_escrow_transactions_ledger_seq;

    ALTER TABLE safetrust.escrow_transactions
      DROP COLUMN IF EXISTS amount,
      DROP COLUMN IF EXISTS balance,
      DROP COLUMN IF EXISTS ledger_seq,
      DROP COLUMN IF EXISTS network,
      DROP COLUMN IF EXISTS contract_id,
      DROP COLUMN IF EXISTS property_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'safetrust' AND table_name = 'trustless_work_escrows'
  ) THEN
    DROP INDEX IF EXISTS safetrust.idx_trustless_escrows_booking_id;
    DROP INDEX IF EXISTS safetrust.idx_trustless_escrows_hotel_id;
    DROP INDEX IF EXISTS safetrust.idx_trustless_escrows_guest_id;

    ALTER TABLE safetrust.trustless_work_escrows
      DROP COLUMN IF EXISTS booking_id,
      DROP COLUMN IF EXISTS room_id,
      DROP COLUMN IF EXISTS hotel_id,
      DROP COLUMN IF EXISTS guest_id,
      DROP COLUMN IF EXISTS check_in_date,
      DROP COLUMN IF EXISTS check_out_date,
      DROP COLUMN IF EXISTS booking_created_at,
      DROP COLUMN IF EXISTS booking_metadata;

    COMMENT ON COLUMN safetrust.trustless_work_escrows.apartment_id IS
      'FK to apartments; kept because an escrow may exist without a reservation. Booking details are read from safetrust.reservations.escrow_id';
  END IF;
END $$;
