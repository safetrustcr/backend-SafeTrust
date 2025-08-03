-- Alice's primary Ethereum wallet
INSERT INTO users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, '0xAliceEthWallet1234567890abcdef', 'ethereum', TRUE
FROM users WHERE email = 'alice.renter@example.com';

-- Bob's Solana wallet
INSERT INTO users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'BobSolanaWallet1234567890abcdef', 'solana', TRUE
FROM users WHERE email = 'bob.owner@example.com';

-- Charlie's Polygon wallet
INSERT INTO users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, '0xCharliePolygonWalletABCDEF123456', 'polygon', TRUE
FROM users WHERE email = 'charlie.witness@example.com';

-- Diana has two wallets: one primary and one secondary

-- Diana's primary Ethereum wallet
INSERT INTO users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, '0xDianaPrimaryWallet1234567890', 'ethereum', TRUE
FROM users WHERE email = 'diana.renter@example.com';

-- Diana's secondary Solana wallet
INSERT INTO users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'DianaSecondarySolanaWalletABC123', 'solana', FALSE
FROM users WHERE email = 'diana.renter@example.com';
