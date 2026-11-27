INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'GCY56BZIV5XIZNTCCZMIMSAG62Z7QHHVEYDPQYGMO3D7RBP5T4CQEEZX', 'stellar', TRUE
FROM hotel_industry.users WHERE email = 'alice.renter@example.com'
ON CONFLICT (wallet_address) DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'GAZ6DAONCUZYNJLSYSBCCYD6DUEAKXSDSYZNZDENCCHNEIBDZ7QUKUNO', 'stellar', TRUE
FROM hotel_industry.users WHERE email = 'bob.owner@example.com'
ON CONFLICT (wallet_address) DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'GBTJ6B2RCMFHEVQDFWNPIRHVOSJ2K32V5PE6RFOK2XWTFRM5S5MW4GWD', 'stellar', TRUE
FROM hotel_industry.users WHERE email = 'charlie.witness@example.com'
ON CONFLICT (wallet_address) DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'GARG4Q6BVZW3TDTSBTX5JNSZWBJDZQYBNX5UJGJ7OZH2DRAP67KCWR27', 'stellar', TRUE
FROM hotel_industry.users WHERE email = 'diana.renter@example.com'
ON CONFLICT (wallet_address) DO NOTHING;

INSERT INTO hotel_industry.users_wallets (user_id, wallet_address, chain_type, is_primary)
SELECT id, 'GCAZCGSWQFL3WJULSGVTXU7TFVFUJWBVO2JN52T5QISGW3NEW6JLCUD7', 'stellar', FALSE
FROM hotel_industry.users WHERE email = 'diana.renter@example.com'
ON CONFLICT (wallet_address) DO NOTHING;
