-- Migration: escrow_user_by_id
-- Replace escrow_transaction_users.user_email with user_id and harden constraints.

-- 1. Add the new column and backfill it from users.