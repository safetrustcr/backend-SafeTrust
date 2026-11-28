-- Database hardening — least-privilege service roles and server-side timeouts.
--
-- The Docker hardening issue owns the full role setup (credentials, the
-- separate metadata database, connection changes). This migration is
-- deliberately self-contained so a tenant deployed on its own still works:
-- it creates the two roles idempotently and pins server-side timeouts.
--
-- statement_timeout bounds how long a single statement may run for a service
-- role, so a runaway query (or a crashed transaction holding locks) is
-- cancelled by the server instead of blocking escrow updates. Migrations and
-- superuser sessions are not affected: they connect as postgres, which keeps
-- the unlimited default.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hasura') THEN
    CREATE ROLE hasura LOGIN; -- security-reviewed: dedicated least-privilege role for Hasura
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webhook') THEN
    CREATE ROLE webhook LOGIN; -- security-reviewed: dedicated least-privilege role for the webhook
  END IF;
END
$$;

-- Cancel statements that run longer than the budget (webhook query_timeout is
-- client-side only; this bounds the server side too).
ALTER ROLE hasura SET statement_timeout = '30s'; -- security-reviewed: bound server-side query time
ALTER ROLE webhook SET statement_timeout = '30s'; -- security-reviewed: bound server-side query time

-- Abort transactions left idle open, so they stop holding locks and snapshots.
ALTER ROLE hasura SET idle_in_transaction_session_timeout = '60s'; -- security-reviewed: abort idle-in-transaction sessions
ALTER ROLE webhook SET idle_in_transaction_session_timeout = '60s'; -- security-reviewed: abort idle-in-transaction sessions
