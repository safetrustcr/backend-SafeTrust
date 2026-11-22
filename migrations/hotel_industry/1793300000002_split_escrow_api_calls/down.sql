-- Reverse of split_escrow_api_calls: remerge the API call log into
-- escrow_transactions and restore the old type columns.

-- 1. Recreate the legacy columns on escrow_transactions.
ALTER TABLE hotel_industry.escrow_transactions
    ADD COLUMN IF NOT EXISTS http_status_code integer,
    ADD COLUMN IF NOT EXISTS escrow_payload jsonb,
    ADD COLUMN IF NOT EXISTS fund_payload json,
    ADD COLUMN IF NOT EXISTS transaction_type varchar(200),
    ADD COLUMN IF NOT EXISTS escrow_transaction_type varchar(200);

-- 2. Backfill the legacy columns from the most recent API call of each escrow.
--    For the type columns, prefer the call kind that created the escrow.
UPDATE hotel_industry.escrow_transactions e
SET transaction_type = coalesce(e.transaction_type, latest.kind),
    escrow_transaction_type = coalesce(e.escrow_transaction_type, latest.kind),
    http_status_code = coalesce(e.http_status_code, latest.http_status_code),
    escrow_payload = coalesce(e.escrow_payload, latest.request),
    fund_payload = coalesce(e.fund_payload, latest.response)
FROM (
    SELECT escrow_transaction_id,
           Distinct ON (escrow_transaction_id) kind,
           http_status_code,
           request,
           response
    FROM hotel_industry.escrow_api_calls
    ORDER BY kind, created_at DESC
) latest
WHERE latest.escrow_transaction_id = e.id;

-- 3. Drop the API call table.
DROP TABLE IF EXISTS hotel_industry.escrow_api_calls;

-- 4. Restore the old single type column and the old escrow_status type.
--    The new type column is dropped after the legacy columns are restored.
ALTER TABLE hotel_industry.escrow_transactions
    DROP CONSTRAINT IF EXISTS escrow_transactions_escrow_status_check,
    ALTER COLUMN escrow_status TYPE varchar(200);

-- 5. Drop the new type column and its CHECK.
ALTER TABLE hotel_industry.escrow_transactions
    DROP CONSTRAINT IF EXISTS escrow_transactions_type_check,
    DROP COLUMN IF EXISTS type;

-- 6. Restore the old unique constraint on escrow_transaction_users.
ALTER TABLE hotel_industry.escrow_transaction_users
    DROP CONSTRAINT IF EXISTS escrow_transaction_users_escrow_transaction_id_user_id_role_key,
    ADD CONSTRAINT escrow_transaction_users_escrow_transaction_id_role_key UNIQUE (escrow_transaction_id, role);

-- 7. Restore the old column names on escrow_transactions.
ALTER TABLE hotel_industry.escrow_transactions
    RENAME COLUMN type TO transaction_type;
