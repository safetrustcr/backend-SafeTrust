ALTER TABLE safetrust.escrow_confirmation_retries
    DROP CONSTRAINT unique_tenant_tx_action,
    ADD CONSTRAINT unique_tx_action
        UNIQUE (tx_hash, escrow_action);
