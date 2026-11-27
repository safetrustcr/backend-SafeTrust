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
        ),
        removed_retries AS (
            DELETE FROM safetrust.escrow_confirmation_retries AS retries
            USING ranked_retries
            WHERE retries.id = ranked_retries.id
              AND ranked_retries.retry_rank > 1
            RETURNING retries.*
        )
        INSERT INTO safetrust.escrow_confirmation_retries_rollback_archive
        SELECT removed_retries.*, NOW()
        FROM removed_retries;
    END IF;
END
$$;

ALTER TABLE safetrust.escrow_confirmation_retries
    DROP CONSTRAINT unique_tenant_tx_action,
    ADD CONSTRAINT unique_tx_action
        UNIQUE (tx_hash, escrow_action);
