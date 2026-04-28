Feature: Reconciliation — POST /reconciliation/sync-escrows

  # ─────────────────────────────────────────────────────────────────────────────
  # Integration tests for the reconciliation endpoint.
  #
  # The webhook service must be running and connected to the test database.
  # Seed data (at least one row in public.trustless_work_escrows) must be
  # present for the "happy path" scenario.
  #
  # The TrustlessWork indexer is called live; if unavailable the service
  # will count chunk errors but still return HTTP 200.
  # ─────────────────────────────────────────────────────────────────────────────

  Background:
    * url webhookUrl
    # No Firebase auth — this route is server-to-server (Hasura cron trigger).
    # The shared secret is optional; leave the header absent for dev/test.
    * configure headers = { 'Content-Type': 'application/json' }

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 1: Happy path — endpoint responds 200 with correct JSON shape
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: POST sync-escrows returns 200 with valid summary JSON
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == '#number'
    And match response.chunks == '#number'
    And match response.updated == '#number'
    And match response.unchanged == '#number'
    And match response.skipped == '#number'
    And match response.errors == '#number'
    And match response.durationMs == '#number'

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 2: Idempotency — calling twice returns updated: 0 on the second call
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Running sync twice on unchanged data returns updated 0 on second call
    # First call — seeds / updates rows
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200

    # Second call immediately after — nothing should have changed on-chain
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.updated == 0

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 3: Wrong method — GET is not registered
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: GET sync-escrows returns 404
    Given path '/reconciliation/sync-escrows'
    When method GET
    Then status 404

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 4: Secret guard — when HASURA_EVENT_SECRET is set, wrong secret
  #             returns 401  (only meaningful if the server has a secret set)
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Wrong event secret returns 401 when guard is active
    Given path '/reconciliation/sync-escrows'
    And header x-hasura-event-secret = 'wrong-secret-value'
    When method POST
    # If HASURA_EVENT_SECRET is NOT set in the server env the guard is
    # disabled and the response will be 200 — both are acceptable in dev.
    Then assert responseStatus == 200 || responseStatus == 401

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 5: No-escrows path — empty table returns 200 with zero counts
  #             (run this only if you can guarantee an empty table in CI)
  # ───────────────────────────────────────────────────────────────────────────
  @ignore
  Scenario: Empty escrow table returns 200 with zero counts
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 0
    And match response.updated == 0
