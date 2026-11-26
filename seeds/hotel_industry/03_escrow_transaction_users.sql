INSERT INTO hotel_industry.escrow_transaction_users (
    user_email, escrow_transaction_id, role, status, is_primary
) VALUES
  (
    'alice.renter@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-1'),
    'RENTER', 'ACTIVE', true
  ),
  (
    'bob.owner@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-1'),
    'OWNER', 'ACTIVE', true
  ),
  (
    'charlie.witness@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-1'),
    'WITNESS', 'PENDING', false
  ),
  (
    'diana.renter@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-2'),
    'RENTER', 'CONFIRMED', true
  ),
  (
    'bob.owner@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-2'),
    'OWNER', 'ACTIVE', true
  ),
  (
    'alice.renter@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-3'),
    'RENTER', 'FAILED', true
  ),
  (
    'bob.owner@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-3'),
    'OWNER', 'ACTIVE', true
  ),
  (
    'diana.renter@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-4'),
    'RENTER', 'PENDING', true
  ),
  (
    'bob.owner@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-4'),
    'OWNER', 'ACTIVE', true
  )
ON CONFLICT DO NOTHING;
