INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, '0xAliceEthWallet1234567890abcdef', 'ethereum', TRUE
FROM hotel_industry.users WHERE email = 'alice.renter@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'BobSolanaWallet1234567890abcdef', 'solana', TRUE
FROM hotel_industry.users WHERE email = 'bob.owner@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, '0xCharliePolygonWalletABCDEF123456', 'polygon', TRUE
FROM hotel_industry.users WHERE email = 'charlie.witness@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, '0xDianaPrimaryWallet1234567890', 'ethereum', TRUE
FROM hotel_industry.users WHERE email = 'diana.renter@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'DianaSecondarySolanaWalletABC123', 'solana', FALSE
FROM hotel_industry.users WHERE email = 'diana.renter@example.com'
ON CONFLICT DO NOTHING;