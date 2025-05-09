INSERT INTO escrow_transaction_users (user_id, escrow_transaction_id, role, status, is_primary)
VALUES 
('63e85534-5118-4059-81d8-8cfe2ffe6e69', '7ac812ff-c318-488d-9a8a-8975d521325a', 'Buyer', 'Active', true),
('b2d52565-5c66-46d6-8d91-a18f2d577ad9', '5ac9f2ea-a06a-4d49-b738-82c8bfa2438c', 'Seller', 'Active', false),
('9b4fa47b-ee43-476f-a7db-57ae02acef6b', '213490fa-6a15-4f7e-aa42-353bab240bf4', 'Buyer', 'Pending', true),
('80b8cadb-cd93-4566-ac39-e4e0b5fc465f', '0f85bb57-2ebf-43c3-83f4-bdf846a8bed5', 'Seller', 'Pending', false),
('9d6ca695-6f40-4bd2-bddc-b8ab53263c61', '86f50112-a70c-46ec-8a69-e57f040db38a', 'Arbiter', 'Active', true);