Feature: POST /api/escrows/initialize — TrustlessWork on-chain callback

  # ─────────────────────────────────────────────────────────────────────────────
  # Integration tests for the TrustlessWork initialize-escrow callback.
  #
  # The webhook service must be running and connected to the test database.
  # USE_MOCK_DATA=true is set in docker-compose-test.yml so no live
  # TrustlessWork API key is required.
  #
  # Depends on:
  #   - Issue #409 (initialize handler + route registration)
  #   - Issue #410 (seed-test-escrows.sql fixture)
  # ─────────────────────────────────────────────────────────────────────────────

  Background:
    * url webhookUrl
    # No Firebase auth — this is a server-to-server TrustlessWork callback.
    # seed-test-escrows.sql does DELETE + re-INSERT on escrow-created-001
    # so the duplicate contract_id scenario is guaranteed a fresh row.
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_TEST_CONTRACT_001'")
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_TEST_CONTRACT_002'")

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 1: Happy path — valid callback persists escrow with status created
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Valid TrustlessWork callback persists escrow with status created
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contract_id": "STELLAR_TEST_CONTRACT_001",
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111",
      "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111",
      "amount": 2500.00,
      "escrow_type": "single_release",
      "asset_code": "USDC"
    }
    """
    When method POST
    Then status 200
    And match response.received == true

    * def rows = db.query("SELECT * FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_TEST_CONTRACT_001'")
    And match rows[0].status == 'created'
    And match rows[0].marker == 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    And match rows[0].amount == '2500.0000000'
    And match rows[0].tenant_id == 'safetrust'

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 2: Missing contract_id returns 400
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Missing contract_id returns 400
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111",
      "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111",
      "amount": 2500.00,
      "escrow_type": "single_release"
    }
    """
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contract_id, marker, approver, releaser, amount, escrow_type'

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 3: Invalid escrow_type returns 400
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Invalid escrow_type returns 400
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contract_id": "STELLAR_TEST_CONTRACT_002",
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111",
      "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111",
      "amount": 2500.00,
      "escrow_type": "invalid_type"
    }
    """
    When method POST
    Then status 400
    And match response.error contains 'escrow_type must be one of'

  # ───────────────────────────────────────────────────────────────────────────
  # Scenario 4: Duplicate contract_id returns 500 — UNIQUE constraint enforced
  # ───────────────────────────────────────────────────────────────────────────
  Scenario: Duplicate contract_id returns 500 — UNIQUE constraint enforced
    # escrow-created-001 is pre-seeded by seed-test-escrows.sql (DELETE + re-INSERT in Background)
    # Attempting to insert the same contract_id again must surface the Hasura UNIQUE violation
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contract_id": "escrow-created-001",
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111",
      "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111",
      "amount": 2500.00,
      "escrow_type": "single_release"
    }
    """
    When method POST
    Then status 500
    And match response.error == 'Failed to persist escrow record'
