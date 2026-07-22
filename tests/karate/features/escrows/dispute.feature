Feature: POST /api/escrows/dispute — TrustlessWork dispute callback

  Background:
    * url webhookUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Valid dispute callback updates escrow status to disputed
    * def body = { "contractId": "escrow-funded-001", "disputeFlag": true, "disputer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status FROM public.trustless_work_escrows WHERE contract_id = 'escrow-funded-001'")
    And match rows[0].status == 'disputed'

  Scenario: Missing contractId returns 400
    * def body = { "disputeFlag": true, "disputer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, disputeFlag, disputer'

  Scenario: disputeFlag false returns 400
    * def body = { "contractId": "escrow-funded-001", "disputeFlag": false, "disputer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'disputeFlag must be true to open a dispute'

  Scenario: Unknown contractId returns 404
    * def body = { "contractId": "non-existent-xyz", "disputeFlag": true, "disputer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'

  Scenario: Missing signature header returns 401
    * def body = { "contractId": "escrow-funded-001", "disputeFlag": true, "disputer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Missing x-trustlesswork-signature header'

  Scenario: Incorrect signature returns 401
    * def body = { "contractId": "escrow-funded-001", "disputeFlag": true, "disputer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z" }
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Invalid webhook signature'
