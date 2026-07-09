Feature: POST /api/escrows/release-funds

  Background:
    * url webhookUrl
    * def contractId = 'escrow-funded-001'
    * def releaseSigner = 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Successfully release funds -> update status and balance to 0 -> 200 OK
    Given path '/api/escrows/release-funds'
    And request { contractId: '#(contractId)', releaseSigner: '#(releaseSigner)' }
    When method POST
    Then status 200
    And match response == { received: true }
    * def rows = db.query("SELECT status, balance FROM public.trustless_work_escrows WHERE contract_id = '" + contractId + "'")
    And match rows[0].status == 'completed'
    And assert rows[0].balance == '0' || rows[0].balance == '0.0000000'

  Scenario: Missing contractId -> 400 Bad Request
    Given path '/api/escrows/release-funds'
    And request { releaseSigner: '#(releaseSigner)' }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, releaseSigner'

  Scenario: Missing releaseSigner -> 400 Bad Request
    Given path '/api/escrows/release-funds'
    And request { contractId: '#(contractId)' }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, releaseSigner'

  Scenario: Escrow not found -> 404 Not Found
    Given path '/api/escrows/release-funds'
    And request { contractId: 'non-existent-contract', releaseSigner: '#(releaseSigner)' }
    When method POST
    Then status 404
    And match response.error == 'Escrow not found for contractId: non-existent-contract'
