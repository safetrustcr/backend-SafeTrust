INSERT INTO hotel_industry.escrow_transaction_users (
    user_email, escrow_transaction_id, role, status, is_primary
) VALUES
  (
    'alice.renter@example.com',
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-1'),
    'RENTER', 'ACTIVE', true
  ),
  (
    (SELECT email FROM hotel_industry.users WHERE email = 'bob.owner@example.com'),
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-1'),
    'OWNER', 'ACTIVE', true
  ),
  (
    (SELECT email FROM hotel_industry.users WHERE email = 'charlie.witness@example.com'),
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-1'),
    'WITNESS', 'PENDING', false
  ),
  (
    (SELECT email FROM hotel_industry.users WHERE email = 'diana.renter@example.com'),
    (SELECT id FROM hotel_industry.escrow_transactions WHERE contract_id = 'contract-2'),
    'RENTER', 'CONFIRMED', true
  )
ON CONFLICT DO NOTHING;