-- Bind a settled x402 payment proof to the reservation it paid for.
-- Direct (hold-less) bookings settle the fee before the reservation exists, so
-- the binding is recorded once the reservation is created. A proof may
-- authorize at most one reservation: retries return that reservation instead
-- of creating a second one.

ALTER TABLE safetrust.x402_settlements
  ADD COLUMN reservation_id UUID REFERENCES safetrust.reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_x402_settlements_reservation_id
  ON safetrust.x402_settlements (reservation_id)
  WHERE reservation_id IS NOT NULL;

COMMENT ON COLUMN safetrust.x402_settlements.reservation_id
  IS 'Reservation this settled proof paid for (direct bookings); NULL until bound.';
