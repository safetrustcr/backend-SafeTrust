Feature: Reconciliation — POST /reconciliation/sync-escrows

  # ─────────────────────────────────────────────────────────────────────────────
  # Integration tests for the reconciliation endpoint.
  #
  # The webhook service must be running and connected to the test database.
  # Seed data (at least one row in safetrust.trustless_work_escrows) must be
  # present for the "happy path" scenario.
  #
  # The TrustlessWork indexer is called live; if unavailable the service
  # will count chunk errors but still return HTTP 200.
  # ─────────────────────────────────────────────────────────────────────────────

  Background:
    * url webhookUrl
    # No Firebase auth — this route is server-to-server (Hasura cron trigger).
    # The shared secret comes from karate-config.js (TEST_EVENT_SECRET in the
    # test stack, default test-event-secret) and must match the webhook's
    # HASURA_EVENT_SECRET; the guard rejects any call without it.
    * configure headers = { 'Content-Type': 'application/json', 'x-hasura-event-secret': '#(eventSecret)' }

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 1: Happy path — endpoint responds 200 with correct JSON shape
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: POST sync-escrows returns 200 with valid summary JSON
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.data.totalEscrows == '#number'
    And match response.data.chunks == '#number'
    And match response.data.updated == '#number'
    And match response.data.unchanged == '#number'
    And match response.data.skipped == '#number'
    And match response.data.staleCount == '#number'
    And match response.data.staleContractIds == '#[]'
    And match response.data.errors == '#number'
    And match response.data.sorobanEnabled == false
    And match response.data.sorobanDrift == 0
    And match response.data.sorobanCorrected == 0
    And match response.data.durationMs == '#number'

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
    And match response.data.updated == 0

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 3: Wrong method — GET is not registered
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: GET sync-escrows returns 404
    Given path '/reconciliation/sync-escrows'
    When method GET
    Then status 404

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 4: Secret guard — wrong secret returns 401
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Wrong event secret returns 401
    Given path '/reconciliation/sync-escrows'
    And header x-hasura-event-secret = 'wrong-secret-value'
    When method POST
    Then status 401
    And match response.error == 'Unauthorized: invalid event secret'

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 5: Secret guard — missing secret header returns 401
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Missing event secret returns 401
    Given path '/reconciliation/sync-escrows'
    # Drop the Background secret header for this call only.
    * configure headers = { 'Content-Type': 'application/json' }
    When method POST
    Then status 401
    And match response.error == 'Unauthorized: invalid event secret'

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 6: No-escrows path — empty table returns 200 with zero counts
  #             (run this only if you can guarantee an empty table in CI)
  # ───────────────────────────────────────────────────────────────────────────
  @ignore
  Scenario: Empty escrow table returns 200 with zero counts
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.data.totalEscrows == 0
    And match response.data.updated == 0
    And match response.data.staleCount == 0
    And match response.data.staleContractIds == []
