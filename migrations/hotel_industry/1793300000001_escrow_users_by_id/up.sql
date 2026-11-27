-- Migration: escrow_user_by_id
-- Replace escrow_transaction_users.user_email with user_id and harden constraints.

-- 1. Add the new column and backfill it from users.
ALTER TABLE hotel_industry.escrow_transaction_users
    ADD COLUMN IF NOT EXISTS user_id UUID;

UPDATE hotel_industry.escrow_transaction_users etu
SET user_id = u.id
FROM hotel_industry.users u
WHERE u.email = etu.user_email
  AND etu.user_id IS NULL;

-- 2. Refuse to continue when an escrow party cannot be linked to a user,
--    rather than silently dropping the party.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM hotel_industry.escrow_transaction_users
        WHERE user_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'escrow_transaction_users rows without a matching users.email cannot be normalized';
    END IF;
END $$;

-- 3. Make user_id required and reference users.
ALTER TABLE hotel_industry.escrow_transaction_users
    ALTER COLUMN user_id SET NOT NULL,
    ADD CONSTRAINT escrow_transaction_users_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES hotel_industry.users(id);

CREATE INDEX IF NOT EXISTS idx_hotel_escrow_tx_users_user_id
    ON hotel_industry.escrow_transaction_users(user_id);

-- 4. Drop the old email foreign key, index and column.
ALTER TABLE hotel_industry.escrow_transaction_users
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_user_email_fkey;

DROP INDEX IF EXISTS hotel_industry.idx_hotel_escrow_tx_users_email;

ALTER TABLE hotel_industry.escrow_transaction_users
    DROP COLUMN IF EXISTS user_email;

-- 5. An escrow party must belong to an escrow transaction.
ALTER TABLE hotel_industry.escrow_transaction_users
    ALTER COLUMN escrow_transaction_id SET NOT NULL;

-- 6. Replace the email-based unique constraint with the id-based one.
ALTER TABLE hotel_industry.escrow_transaction_users
    DROP CONSTRAINT IF EXISTS unique_hotel_escrow_user_role,
    ADD CONSTRAINT escrow_transaction_users_escrow_transaction_id_user_id_role_key
        UNIQUE (escrow_transaction_id, user_id, role);

-- 7. Harden the enumerated columns. UPPER() keeps the checks compatible with
--    the existing upper-case values while rejecting unknown ones.
ALTER TABLE hotel_industry.escrow_transaction_users
    ADD CONSTRAINT escrow_transaction_users_role_check
        CHECK (UPPER(role) IN ('OWNER', 'HOST', 'RENTER', 'GUEST', 'WITNESS')),
    ADD CONSTRAINT escrow_transaction_users_status_check
        CHECK (
            status IS NULL
            OR UPPER(status) IN (
                'PENDING', 'ACTIVE', 'CONFIRMED', 'FUNDED',
                'RELEASED', 'REFUNDED', 'CANCELLED', 'FAILED'
            )
        ),
    ADD CONSTRAINT escrow_transaction_users_funding_status_check
        CHECK (
            funding_status IS NULL
            OR UPPER(funding_status) IN ('PENDING', 'PARTIAL', 'FUNDED', 'FAILED', 'REFUNDED')
        );
