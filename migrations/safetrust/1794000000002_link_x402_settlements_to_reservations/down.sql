DROP INDEX IF EXISTS safetrust.idx_x402_settlements_reservation_id;

ALTER TABLE safetrust.x402_settlements
  DROP COLUMN IF EXISTS reservation_id;
