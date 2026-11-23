-- Reverse of the escrow_transaction_users normalization.
-- Restores the old email-based schema and backfills user_email from users.

-- 1. Add the old column back.
ALTER TABLE hotel_industry.escrow_transaction_users
    ADD COLUMN IF NOT EXISTS user_email VARCHAR(150);

-- 2. Backfill user_email from the referenced users row.
UPDATE hotel_industry.escrow_transaction_users etu
SET user_email = u.email
FROM hotel_industry.users u
WHERE u.id = etu.user_id;

-- 3. Drop the new constraints and indexes.
ALTER TABLE hotel_industry.escrow_transaction_users
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_role_check,
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_status_check,
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_funding_status_check,
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_escrow_transaction_id_user_id_role_key;

DROP INDEX IF EXISTS hotel_industry.idx_hotel_escrow_tx_users_user_id;

-- 4. Restore the original email-based unique constraint and foreign key.
ALTER TABLE hotel_industry.escrow_transaction_users
    ADD CONSTRAINT unique_hotel_escrow_user_role
        UNIQUE (escrow_transaction_id, user_email, role),
    ADD CONSTRAINT escrow_transaction_users_user_email_fkey
        FOREIGN KEY (user_email) REFERENCES hotel_industry.users(email);

CREATE INDEX IF NOT EXISTS idx_hotel_escrow_tx_users_email
    ON hotel_industry.escrow_transaction_users(user_email);

-- 5. Restore the original nullability and drop the new column.
ALTER TABLE hotel_industry.escrow_transaction_users
    ALTER COLUMN escrow_transaction_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_user_id_fkey,
    DROP COLUMN IF EXISTS user_id;
