-- Seed data for users_wallets table (hotel_industry)
-- Inserts multiple wallets per user, covering various blockchain networks

INSERT INTO users_wallets (
    user_id, 
    wallet_address, 
    chain_type, 
    is_primary
) VALUES 
    -- John Doe: Ethereum (primary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '0x742d35Cc6464C5c4E8b26B5C5E1B35C6F3C9F3d1',
        'Ethereum',
        true
    ),
    -- John Doe: Polygon (secondary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '0x8ba1f109551bD432803012645Hac136c83F77c9',
        'Polygon',
        false
    ),
    -- John Doe: BSC (secondary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '0x3f5CE5FBFe3E9af3971dD833D26BA9b5C936f0bE',
        'BSC',
        false
    ),
    -- John Doe: Avalanche (secondary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
        'Avalanche',
        false
    ),
    -- John Doe: Base (secondary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '0xA16081F360e3847006dB660bae1c6d1b2e17eC2A',
        'Base',
        false
    ),
    -- John Doe: Bitcoin (primary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        'Bitcoin',
        true
    ),
    -- John Doe: Solana (secondary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '7G7e1nQ2v3w4x5y6z7a8b9c0d1e2f3g4h5i6j7k8l9m',
        'Solana',
        false
    ),
    -- John Doe: Arbitrum (secondary)
    (
        (SELECT id FROM users WHERE email = 'john.doe@example.com'),
        '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
        'Arbitrum',
        false
    ),

    -- Jane Smith: Ethereum (secondary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE',
        'Ethereum',
        false
    ),
    -- Jane Smith: Polygon (primary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '0x7e5F4552091A69125d5DfCb7b8C2659029395Bdf',
        'Polygon',
        true
    ),
    -- Jane Smith: BSC (secondary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '0x28C6c06298d514Db089934071355E5743bf21d60',
        'BSC',
        false
    ),
    -- Jane Smith: Avalanche (secondary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '0xE3A268d590a47bD6bE1aB7A2e6e6bC1b9B6bA1b7',
        'Avalanche',
        false
    ),
    -- Jane Smith: Base (secondary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '0xF977814e90dA44bFA03b6295A0616a897441aceC',
        'Base',
        false
    ),
    -- Jane Smith: Bitcoin (primary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
        'Bitcoin',
        true
    ),
    -- Jane Smith: Solana (secondary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '4Z9e1nQ2v3w4x5y6z7a8b9c0d1e2f3g4h5i6j7k8l9m',
        'Solana',
        false
    ),
    -- Jane Smith: Arbitrum (secondary)
    (
        (SELECT id FROM users WHERE email = 'jane.smith@example.com'),
        '0xB8c77482e45F1F44dE1745F52C74426C631bDD52',
        'Arbitrum',
        false
    ),

    -- Alice Wonder: Ethereum (secondary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '0x742d35Cc6464C5c4E8b26B5C5E1B35C6F3C9F3d2',
        'Ethereum',
        false
    ),
    -- Alice Wonder: Polygon (secondary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '0x53d284357ec70cE289D6D64134DfAc8E511c8a3D',
        'Polygon',
        false
    ),
    -- Alice Wonder: BSC (primary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '0xFE9e8709d3215310075d67E3ed32A380CCf451C8',
        'BSC',
        true
    ),
    -- Alice Wonder: Avalanche (secondary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '0xBf7A7169562078c96f0eC1A8aFD6aE50f12e5A99',
        'Avalanche',
        false
    ),
    -- Alice Wonder: Base (secondary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '0x61edCdF5bb737ADffE5043706e7C5bb1f1a56eEA',
        'Base',
        false
    ),
    -- Alice Wonder: Bitcoin (primary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        'Bitcoin',
        true
    ),
    -- Alice Wonder: Solana (secondary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '8G8e2nQ3v4w5x6y7z8a9b0c1d2e3f4g5h6i7j8k9l0m',
        'Solana',
        false
    ),
    -- Alice Wonder: Arbitrum (secondary)
    (
        (SELECT id FROM users WHERE email = 'alice.wonder@example.com'),
        '0xDc76Cd25977E0a5Ae17155770273aD58648900D3',
        'Arbitrum',
        false
    );



-- To verify inserted data, run the following query after seeding:
-- SELECT 
--     u.email, 
--     uw.wallet_address, 
--     uw.chain_type, 
--     uw.is_primary
-- FROM 
--     users_wallets uw
-- JOIN 
--     users u ON uw.user_id = u.id;