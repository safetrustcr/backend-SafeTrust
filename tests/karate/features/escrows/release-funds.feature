Feature: POST /api/escrows/release-funds

  Background:
    * url webhookUrl
    * def contractId = 'escrow-funded-001'
    * def releaseSigner = 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Successfully release funds -> update status and balance to 0 -> 200 OK
    * def body = { contractId: contractId, releaseSigner: releaseSigner }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/release-funds'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response == { received: true }
    * def rows = db.query("SELECT status, balance FROM public.trustless_work_escrows WHERE contract_id = '" + contractId + "'")
    And match rows[0].status == 'completed'
    And assert rows[0].balance == '0' || rows[0].balance == '0.0000000'

  Scenario: Missing contractId -> 400 Bad Request
    * def body = { releaseSigner: releaseSigner }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/release-funds'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, releaseSigner'

  Scenario: Missing releaseSigner -> 400 Bad Request
    * def body = { contractId: contractId }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/release-funds'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, releaseSigner'

  Scenario: Escrow not found -> 404 Not Found
    * def body = { contractId: 'non-existent-contract', releaseSigner: releaseSigner }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/release-funds'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 404
    And match response.error == 'Escrow not found for contractId: non-existent-contract'

  Scenario: Missing signature header returns 401
    * def body = { contractId: contractId, releaseSigner: releaseSigner }
    Given path '/api/escrows/release-funds'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Missing x-trustlesswork-signature header'

  Scenario: Incorrect signature returns 401
    * def body = { contractId: contractId, releaseSigner: releaseSigner }
    Given path '/api/escrows/release-funds'
    And header x-trustlesswork-signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Invalid webhook signature'
