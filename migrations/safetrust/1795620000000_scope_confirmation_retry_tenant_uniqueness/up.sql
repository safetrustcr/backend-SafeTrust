ALTER TABLE safetrust.escrow_confirmation_retries
    DROP CONSTRAINT unique_tx_action,
    ADD CONSTRAINT unique_tenant_tx_action
        UNIQUE (tenant_id, tx_hash, escrow_action);

-- Restore rows removed by down.sql without overwriting progress recorded
-- after the rollback archive was created.
DO $$
BEGIN
    IF to_regclass('safetrust.escrow_confirmation_retries_rollback_archive') IS NOT NULL THEN
        INSERT INTO safetrust.escrow_confirmation_retries (
            id,
            tx_hash,
            escrow_id,
            escrow_action,
            network,
            submission_path,
            status,
            attempt_count,
            max_attempts,
            next_retry_at,
            last_error,
            metadata,
            created_at,
            updated_at,
            tenant_id
        )
        SELECT
            archived.id,
            archived.tx_hash,
            archived.escrow_id,
            archived.escrow_action,
            archived.network,
            archived.submission_path,
            archived.status,
            archived.attempt_count,
            archived.max_attempts,
            archived.next_retry_at,
            archived.last_error,
            archived.metadata,
            archived.created_at,
            archived.updated_at,
            archived.tenant_id
        FROM safetrust.escrow_confirmation_retries_rollback_archive AS archived
        WHERE NOT EXISTS (
            SELECT 1
            FROM safetrust.escrow_confirmation_retries AS current_retry
            WHERE current_retry.tenant_id = archived.tenant_id
              AND current_retry.tx_hash = archived.tx_hash
              AND current_retry.escrow_action = archived.escrow_action
        )
        ON CONFLICT (tenant_id, tx_hash, escrow_action) DO NOTHING;

        DELETE FROM safetrust.escrow_confirmation_retries_rollback_archive;
    END IF;
END
$$;
