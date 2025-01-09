INSERT INTO user_wallets (
    id,
    user_id,
    wallet_address,
    chain_type,
    is_primary,
    created_at,
    updated_at
) VALUES 
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'maria.rodriguez@example.com'),
    '0x02d395b1c1538dedfa511791bff69c29bc178bbb3f2dd9f8eb7kc30e92hjjdf0',
    'BSC',
    true,
    NOW() - INTERVAL '2 days', 
    NOW() - INTERVAL '1 days'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'ana.castro@example.com'),
    '0x02d365b1c1538dedfa511791bff69c29bc178aaa3f2dd9f8eb7kc30e12hjjdf0',
    'ETH',
    true,
    NOW() - INTERVAL '2 days', 
    NOW() - INTERVAL '1 days'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'pedro.solano@example.com'),
    '0x02d355b1c1538dedfa511791bff69c29bc178ccc3f2cc9f8eb7kc70e92hjjdf0',
    'STELLAR',
    true,
    NOW() - INTERVAL '2 days', 
    NOW() - INTERVAL '1 days'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'carlos.jimenez@example.com'),
    '0x02d345b1c1538dedfa94501bff69c29bc178ttt3f2tt9f8eb7kc30e92hjjdf0',
    'ETH',
    true,
    NOW() - INTERVAL '2 days', 
    NOW() - INTERVAL '1 days'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'roberto.mora@example.com'),
    '0x02d335b1c1538dedfa34323bff69c29bc178uuu3f2dd9f8eb7kc30e92hjjdf0',
    'BSC',
    true,
    NOW() - INTERVAL '2 days', 
    NOW() - INTERVAL '1 days'
),
(
    uuid_generate_v4(),
    (SELECT id FROM users WHERE email = 'laura.vargas@example.com'),
    '0x02d325b1c1538dedfa22332bff69c29bc178ggg3f2gg9f8eb7kc30e92hjjdf0',
    'STELLAR',
    true,
    NOW() - INTERVAL '2 days', 
    NOW() - INTERVAL '1 days'
);