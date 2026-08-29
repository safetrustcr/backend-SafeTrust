-- seeds/hotel_industry/02_escrow_transactions.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.escrow_transactions (
    reservation_id, contract_id, escrow_status,
    signer_address, transaction_type, escrow_transaction_type, http_status_code
) VALUES
  (NULL, 'contract-1', 'PENDING',   '0xAliceSignerAddress1234', 'RENTAL', 'ESCROW_INIT',    200),
  (NULL, 'contract-2', 'CONFIRMED', '0xDianaSigner9876',        'RENTAL', 'ESCROW_CONFIRM', 200),
  (NULL, 'contract-3', 'FAILED',    '0xBobSignerFail',          'RENTAL', 'ESCROW_FAIL',    500),
  (NULL, 'contract-4', 'PENDING',   '0xWitnessSignerPending',   'RENTAL', 'ESCROW_INIT',    102)
ON CONFLICT DO NOTHING;