Feature: POST /api/escrows/deploy — TrustlessWork on-chain callback

  Background:
    * url webhookUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_TEST_CONTRACT_001'")
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_TEST_CONTRACT_002'")

  Scenario: Valid TrustlessWork callback persists escrow with status created
    Given path '/api/escrows/deploy'
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

  Scenario: Missing contract_id returns 400
    Given path '/api/escrows/deploy'
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

  Scenario: Invalid escrow_type returns 400
    Given path '/api/escrows/deploy'
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

  Scenario: Duplicate contract_id returns 500 — UNIQUE constraint enforced
    Given path '/api/escrows/deploy'
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
