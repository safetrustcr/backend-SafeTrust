-- Reverse of split_escrow_api_calls: remerge the API call log into
-- escrow_transactions and restore the old type columns.

-- 1. Recreate the legacy columns on escrow_transactions.
ALTER TABLE hotel_industry.escrow_transactions
    ADD COLUMN IF NOT EXISTS http_status_code integer,
    ADD COLUMN IF NOT EXISTS escrow_payload jsonb,
    ADD COLUMN IF NOT EXISTS fund_payload jsonb,
    ADD COLUMN IF NOT EXISTS transaction_type varchar(200),
    ADD COLUMN IF NOT EXISTS escrow_transaction_type varchar(200);

-- 2. Restore the legacy type columns from the consolidated type.
UPDATE hotel_industry.escrow_transactions
SET transaction_type = type,
    escrow_transaction_type = type
WHERE transaction_type IS NULL
   OR escrow_transaction_type IS NULL;

-- 3. Backfill the payload/status columns from the most recent API call of
--    each kind.
UPDATE hotel_industry.escrow_transactions e
SET escrow_payload = c.request,
    http_status_code = COALESCE(e.http_status_code, c.http_status_code)
FROM (
    SELECT DISTINCT ON (escrow_transaction_id)
        escrow_transaction_id,
        http_status_code,
        request
    FROM hotel_industry.escrow_api_calls
    WHERE kind = 'escrow'
    ORDER BY escrow_transaction_id, created_at DESC
) c
WHERE c.escrow_transaction_id = e.id;

UPDATE hotel_industry.escrow_transactions e
SET fund_payload = c.request,
    http_status_code = COALESCE(e.http_status_code, c.http_status_code)
FROM (
    SELECT DISTINCT ON (escrow_transaction_id)
        escrow_transaction_id,
        http_status_code,
        request
    FROM hotel_industry.escrow_api_calls
    WHERE kind = 'fund'
    ORDER BY escrow_transaction_id, created_at DESC
) c
WHERE c.escrow_transaction_id = e.id;

-- 4. Drop the API call table.
DROP TABLE IF EXISTS hotel_industry.escrow_api_calls;

-- 5. Drop the new type column and its CHECK, and the escrow_status CHECK.
ALTER TABLE hotel_industry.escrow_transactions
    DROP CONSTRAINT IF EXISTS escrow_transactions_type_check,
    DROP CONSTRAINT IF EXISTS escrow_transactions_escrow_status_check,
    DROP COLUMN IF EXISTS type;

-- 6. Restore the original nullability of reservation_id and drop the archive
--    table created by the up migration.
ALTER TABLE hotel_industry.escrow_transactions
    ALTER COLUMN reservation_id DROP NOT NULL;

DROP TABLE IF EXISTS hotel_industry.escrow_transactions_archive;
