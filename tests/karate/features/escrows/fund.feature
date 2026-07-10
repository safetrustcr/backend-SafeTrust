Feature: POST /api/escrows/fund — TrustlessWork fund confirmation callback

  Background:
    * url webhookUrl
    # seed-test-escrows.sql runs DELETE + re-INSERT on every scenario
    # so escrow-created-001 is always reset to status: created, balance: 0
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Valid fund callback updates status to funded and sets balance
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-created-001",
      "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "amount": 2500.00
    }
    """
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, balance FROM public.trustless_work_escrows WHERE contract_id = 'escrow-created-001'")
    And match rows[0].status == 'funded'
    And match rows[0].balance == '2500.0000000'

  Scenario: Missing contractId returns 400
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "amount": 2500.00
    }
    """
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, signer, amount'

  Scenario: Missing signer returns 400
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-created-001",
      "amount": 2500.00
    }
    """
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, signer, amount'

  Scenario: Amount zero returns 400
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-created-001",
      "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "amount": 0
    }
    """
    When method POST
    Then status 400
    And match response.error == 'Amount cannot be zero or negative'

  Scenario: Unknown contractId returns 404
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "non-existent-contract-xyz",
      "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "amount": 1000.00
    }
    """
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'

