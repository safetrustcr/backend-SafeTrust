Feature: Database hardening — timeouts, privileges, extensions, audit and retention

  # Asserts the schema-level hardening applied by the migration series
  # 1796000000000–1796000000003 (issue #831). These checks talk to the live test
  # database through the JDBC helper (config.db) and do not need the webhook.
  #
  # Every check is self-contained: rows it writes carry a unique marker and are
  # removed in afterScenario, so the suite stays re-runnable and parallel-safe.

  Background:
    * def marker = 'karate-hardening-' + java.util.UUID.randomUUID().toString()

  # ── Item 2: server-side timeouts are pinned on the service roles ─────────────
  Scenario: hasura and webhook roles carry server-side statement and idle timeouts
    * def rows = db.query("SELECT rolname, coalesce(array_to_string(rolconfig, ','), '') AS cfg FROM pg_roles WHERE rolname IN ('hasura', 'webhook') ORDER BY rolname")
    * match rows.length == 2
    * match rows[0].cfg contains 'statement_timeout=30s'
    * match rows[0].cfg contains 'idle_in_transaction_session_timeout=60s'
    * match rows[1].cfg contains 'statement_timeout=30s'
    * match rows[1].cfg contains 'idle_in_transaction_session_timeout=60s'

  # ── Item 2: a long query is really cancelled server-side ─────────────────────
  Scenario: A statement exceeding statement_timeout is cancelled by the server
    * def wasCancelled =
      """
      function() {
        var DriverManager = Java.type('java.sql.DriverManager');
        var conn = DriverManager.getConnection(
          'jdbc:postgresql://postgres_test:5432/postgres', 'postgres', 'postgrespassword');
        try {
          var stmt = conn.createStatement();
          try {
            // Same session: the timeout persists to the next statement.
            stmt.execute("SET statement_timeout = '500ms'");
            stmt.execute("SELECT pg_sleep(3)");
            return false;
          } catch (e) {
            return true;
          } finally {
            stmt.close();
          }
        } finally {
          conn.close();
        }
      }
      """
    * assert wasCancelled() == true

  # ── Item 3: functions pin search_path and are not PUBLIC-executable ──────────
  Scenario: Every function in the tenant schemas pins a fixed search_path
    * def offenders = db.query("SELECT n.nspname || '.' || p.proname AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('safetrust', 'hotel_industry') AND p.prokind IN ('f', 'p') AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS c WHERE c LIKE 'search_path=%')")
    * match offenders == []

  Scenario: No function in the tenant schemas is executable by PUBLIC
    * def offenders = db.query("SELECT n.nspname || '.' || p.proname AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('safetrust', 'hotel_industry') AND p.prokind IN ('f', 'p') AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')")
    * match offenders == []

  # ── Item 4: unused extensions dropped, dedicated extensions schema exists ───
  Scenario: Unused extensions are dropped and an extensions schema exists
    * def dropped = db.query("SELECT extname FROM pg_extension WHERE extname IN ('postgis_topology', 'postgis_tiger_geocoder', 'fuzzystrmatch', 'pgcrypto')")
    * match dropped == []
    * def extSchema = db.query("SELECT nspname FROM pg_namespace WHERE nspname = 'extensions'")
    * match extSchema.length == 1

  # ── Item 6: user_roles changes are recorded in the audit table ───────────────
  Scenario: Inserting and deleting a user_roles row writes two audit records
    * configure afterScenario =
      """
      function() {
        db.execute("DELETE FROM safetrust.user_roles_audit WHERE user_id = '" + karate.get('auditUserId') + "'");
        db.execute("DELETE FROM safetrust.user_roles WHERE user_id = '" + karate.get('auditUserId') + "'");
        db.execute("DELETE FROM safetrust.users WHERE id = '" + karate.get('auditUserId') + "'");
        db.execute("DELETE FROM safetrust.roles WHERE name = '" + karate.get('auditRoleName') + "'");
      }
      """
    * def auditUserId = marker + '-user'
    * def auditRoleName = marker + '-role'
    * db.execute("INSERT INTO safetrust.users (id, firebase_uid, email) VALUES ('" + auditUserId + "', '" + auditUserId + "', '" + auditUserId + "@example.test')")
    * db.execute("INSERT INTO safetrust.roles (name) VALUES ('" + auditRoleName + "')")
    * def role = db.query("SELECT id FROM safetrust.roles WHERE name = '" + auditRoleName + "'")
    * def roleId = role[0].id
    * db.execute("INSERT INTO safetrust.user_roles (user_id, role_id) VALUES ('" + auditUserId + "', " + roleId + ")")
    * db.execute("DELETE FROM safetrust.user_roles WHERE user_id = '" + auditUserId + "' AND role_id = " + roleId)
    * def audit = db.query("SELECT action FROM safetrust.user_roles_audit WHERE user_id = '" + auditUserId + "' ORDER BY id")
    * match audit == [{ action: 'insert' }, { action: 'delete' }]

  # ── Item 5: retention prunes finished retries and scrubs old payloads ────────
  Scenario: prune_operational_data removes old finished retries and nulls old payloads
    * configure afterScenario =
      """
      function() {
        db.execute("DELETE FROM safetrust.escrow_confirmation_retries WHERE escrow_id = '" + karate.get('retentionEscrowId') + "'");
        db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id = '" + karate.get('retentionContractId') + "'");
      }
      """
    * def retentionEscrowId = marker + '-escrow'
    * def retentionContractId = marker + '-contract'
    * def oldRetryTxHash = marker.replace(/-/g, '').substring(0, 60)
    # A finished retry and a webhook event, both older than the 30/90 day windows.
    * db.execute("INSERT INTO safetrust.escrow_confirmation_retries (tx_hash, escrow_id, escrow_action, status, created_at) VALUES ('" + oldRetryTxHash + "', '" + retentionEscrowId + "', 'deploy', 'completed', NOW() - INTERVAL '200 days')")
    * db.execute("INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, created_at) VALUES ('" + retentionContractId + "', 'escrow_funded', '{\"old\": true}', NOW() - INTERVAL '200 days')")
    # Run the retention job with the production default windows (30 / 90 days).
    * def result = db.query("SELECT deleted_retries, scrubbed_payloads FROM safetrust.prune_operational_data(30, 90)")
    * match result.length == 1
    # The finished retry is gone …
    * def retriesLeft = db.query("SELECT count(*) AS c FROM safetrust.escrow_confirmation_retries WHERE escrow_id = '" + retentionEscrowId + "'")
    * match retriesLeft[0].c == '0'
    # … and the webhook event survives with its payload stripped (event_identity kept).
    * def events = db.query("SELECT payload FROM safetrust.trustless_work_webhook_events WHERE contract_id = '" + retentionContractId + "'")
    * match events.length == 1
    * match events[0].payload == '#null'
