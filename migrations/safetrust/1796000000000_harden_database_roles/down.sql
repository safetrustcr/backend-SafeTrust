-- Revert the per-role server-side timeouts. The roles themselves are kept:
-- dropping them would break any connection that already authenticates as
-- hasura or webhook.

ALTER ROLE hasura RESET statement_timeout; -- security-reviewed: revert role timeout
ALTER ROLE hasura RESET idle_in_transaction_session_timeout; -- security-reviewed: revert role timeout
ALTER ROLE webhook RESET statement_timeout; -- security-reviewed: revert role timeout
ALTER ROLE webhook RESET idle_in_transaction_session_timeout; -- security-reviewed: revert role timeout
