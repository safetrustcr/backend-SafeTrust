-- Split escrow transactions into the escrow itself and a log of the API calls that created it.
-- Also consolidate the two overlapping type columns and add CHECKs on the status values.

-- ----------------------------------------------------------------------------
-- 1. Create the escrow_api_calls log table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotel_industry.escrow_api_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_transaction_id UUID NOT NULL
        REFERENCES hotel_industry.escrow_transactions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    http_status_code INTEGER,
    request jsonb,
    response jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT escrow_api_calls_kind_check CHECK (kind IN ('escrow', 'fund')),
    CONSTRAINT escrow_api_calls_http_check CHECK (
        http_status_code IS NULL OR (http_status_code BETWEEN 100 AND 999)
    )
);

CREATE INDEX IF NOT EXISTS
    escrow_api_calls_escrow_transaction_id_idx
    ON hotel_industry.escrow_api_calls (escrow_transaction_id);

-- ----------------------------------------------------------------------------
-- 2. Backfill the call log from the existing columns.
-- ----------------------------------------------------------------------------
-- Rows that carried an escrow payload become an 'escrow' call.
-- Rows that carried a fund payload become a 'fund' call. The http status
-- code is copied onto both when present.
INSERT INTO hotel_industry.escrow_api_calls (
    escrow_transaction_id,
    kind,
    http_status_code,
    request,
    response
)
SELECT
    id,
    'escrow',
    http_status_code,
    escrow_payload,
    NULL
FROM hotel_industry.escrow_transactions
WHERE escrow_payload IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO hotel_industry.escrow_api_calls (
    escrow_transaction_id,
    kind,
    http_status_code,
    request,
    response
)
SELECT
    id,
    'fund',
    http_status_code,
    fund_payload,
    NULL
FROM hotel_industry.escrow_transactions
WHERE fund_payload IS NOT NULL
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Consolidate the two type columns into one, with a CHECK.
-- ----------------------------------------------------------------------------
-- Prefer the value already present in escrow_transaction_type; fall back to
-- transaction_type. The new column is added as TEXT so the CHECK can be
-- applied after the backfill.
ALTER TABLE hotel_industry.escrow_transactions
    ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE hotel_industry.escrow_transactions
SET type = COALESCE(
    NULLIF(escrow_transaction_type, ''),
    NULLIF(transaction_type, ''),
    ''
)
WHERE type IS NULL;

-- Reject rows that still have no type after the backfill.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM hotel_industry.escrow_transactions
        WHERE type IS NULL OR type = ''
    ) THEN
        RAISE EXCEPTION 'escrow_transactions rows with no type value cannot be normalized';
    END IF;
END $$;

ALTER TABLE hotel_industry.escrow_transactions
    ALTER COLUMN type SET NOT NULL,
    ADD CONSTRAINT escrow_transactions_type_check CHECK (
        LOWER(type) IN ('escrow', 'fund', 'release', 'refund')
    );

-- ----------------------------------------------------------------------------
-- 4. Add a CHECK on escrow_status.
-- ----------------------------------------------------------------------------
ALTER TABLE hotel_industry.escrow_transactions
    ADD CONSTRAINT escrow_transactions_escrow_status_check CHECK (
        escrow_status IS NULL
        OR LOWER(escrow_status) IN (
            'pending',
            'funded',
            'released',
            'refunded',
            'cancelled',
            'failed'
        )
    );

-- ----------------------------------------------------------------------------
-- 5. Drop the API fields from escrow_transactions.
-- ----------------------------------------------------------------------------
ALTER TABLE hotel_industry.escrow_transactions
    DROP COLUMN IF EXISTS http_status_code,
    DROP COLUMN IF EXISTS escrow_payload,
    DROP COLUMN IF EXISTS fund_payload,
    DROP COLUMN IF EXISTS transaction_type,
    DROP COLUMN IF EXISTS escrow_transaction_type;

-- ----------------------------------------------------------------------------
-- 6. reservation_id on escrow_transactions is NOT NULL and points at
--    reservations. The reservations migration runs first and adds the
--    foreign key; here we only enforce NOT NULL. Rows without a
--    reservation are moved to an archive table rather than deleted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotel_industry.escrow_transactions_archive (
    LIKE hotel_industry.escrow_transactions
);

INSERT INTO hotel_industry.escrow_transactions_archive
SELECT * FROM hotel_industry.escrow_transactions
WHERE reservation_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM hotel_industry.escrow_transactions
WHERE reservation_id IS NULL;

ALTER TABLE hotel_industry.escrow_transactions
    ALTER COLUMN reservation_id SET NOT NULL;
