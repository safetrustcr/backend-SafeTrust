Feature: POST /api/escrows/initialize — TrustlessWork initialize callback

  Background:
    * url webhookUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_CONTRACT_TEST_001'")

  Scenario: Valid initialize callback inserts new escrow with status created
    * def body =
    """
    {
      "contract_id": "STELLAR_CONTRACT_TEST_001",
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111",
      "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111",
      "amount": 2500.00,
      "escrow_type": "single_release",
      "asset_code": "USDC"
    }
    """
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, amount, escrow_type, asset_code FROM public.trustless_work_escrows WHERE contract_id = 'STELLAR_CONTRACT_TEST_001'")
    And match rows[0].status == 'created'
    And assert rows[0].amount == '2500' || rows[0].amount == '2500.0000000'
    And match rows[0].escrow_type == 'single_release'
    And match rows[0].asset_code == 'USDC'

  Scenario: Missing required fields returns 400
    * def body =
    """
    {
      "contract_id": "STELLAR_CONTRACT_TEST_001",
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111"
    }
    """
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contract_id, marker, approver, releaser, amount, escrow_type'

  Scenario: Invalid escrow type returns 400
    * def body =
    """
    {
      "contract_id": "STELLAR_CONTRACT_TEST_001",
      "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111",
      "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111",
      "amount": 2500.00,
      "escrow_type": "invalid_type",
      "asset_code": "USDC"
    }
    """
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'escrow_type must be one of: single_release, multi_release'

  Scenario: Duplicate contract_id returns 500 — UNIQUE constraint enforced
    * def body =
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
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 500
    And match response.error == 'Failed to persist escrow record'
    And match response.details[0].message contains 'duplicate key value violates unique constraint'

  Scenario: Missing signature header returns 401
    * def body = { "contract_id": "STELLAR_CONTRACT_TEST_001", "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111", "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111", "amount": 2500.00, "escrow_type": "single_release" }
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Missing x-trustlesswork-signature header'

  Scenario: Incorrect signature returns 401
    * def body = { "contract_id": "STELLAR_CONTRACT_TEST_001", "marker": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "approver": "GAPPROVER111WALLETADDRESS111111111111111111111111111111111", "releaser": "GRELEASER111WALLETADDRESS111111111111111111111111111111111", "amount": 2500.00, "escrow_type": "single_release" }
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Invalid webhook signature'
