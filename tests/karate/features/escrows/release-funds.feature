Feature: POST /api/escrows/release-funds — TrustlessWork fund release callback

  Background:
    * url baseUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Valid release callback updates status to completed and zeroes balance
    Given path '/api/escrows/release-funds'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-funded-001",
      "releaseSigner": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z"
    }
    """
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, balance FROM public.trustless_work_escrows WHERE contract_id = 'escrow-funded-001'")
    And match rows[0].status == 'completed'
    And match rows[0].balance == '0E-7'

  Scenario: Missing contractId returns 400
    Given path '/api/escrows/release-funds'
    And header Content-Type = 'application/json'
    And request { "releaseSigner": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, releaseSigner'

  Scenario: Missing releaseSigner returns 400
    Given path '/api/escrows/release-funds'
    And header Content-Type = 'application/json'
    And request { "contractId": "escrow-funded-001" }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, releaseSigner'

  Scenario: Unknown contractId returns 404
    Given path '/api/escrows/release-funds'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "non-existent-contract-xyz",
      "releaseSigner": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z"
    }
    """
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'
