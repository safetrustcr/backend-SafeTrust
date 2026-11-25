-- Preserve extra tenant-specific retry rows that the old global key cannot represent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM safetrust.escrow_confirmation_retries
        GROUP BY tx_hash, escrow_action
        HAVING COUNT(*) > 1
    ) THEN
        CREATE TABLE IF NOT EXISTS safetrust.escrow_confirmation_retries_rollback_archive (
            LIKE safetrust.escrow_confirmation_retries INCLUDING DEFAULTS,
            archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (id)
        );

        WITH ranked_retries AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY tx_hash, escrow_action
                       ORDER BY created_at, id
                   ) AS retry_rank
            FROM safetrust.escrow_confirmation_retries
        )
        INSERT INTO safetrust.escrow_confirmation_retries_rollback_archive
        SELECT retries.*, NOW()
        FROM safetrust.escrow_confirmation_retries AS retries
        JOIN ranked_retries USING (id)
        WHERE ranked_retries.retry_rank > 1;

        WITH ranked_retries AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY tx_hash, escrow_action
                       ORDER BY created_at, id
                   ) AS retry_rank
            FROM safetrust.escrow_confirmation_retries
        )
        DELETE FROM safetrust.escrow_confirmation_retries AS retries
        USING ranked_retries
        WHERE retries.id = ranked_retries.id
          AND ranked_retries.retry_rank > 1;
    END IF;
END
$$;

ALTER TABLE safetrust.escrow_confirmation_retries
    DROP CONSTRAINT unique_tenant_tx_action,
    ADD CONSTRAINT unique_tx_action
        UNIQUE (tx_hash, escrow_action);
