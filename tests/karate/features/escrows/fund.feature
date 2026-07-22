Feature: POST /api/escrows/fund — TrustlessWork fund confirmation callback

  Background:
    * url webhookUrl
    # seed-test-escrows.sql runs DELETE + re-INSERT on every scenario
    # so escrow-created-001 is always reset to status: created, balance: 0
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))
    * db.execute("DELETE FROM public.trustless_work_webhook_events WHERE contract_id = 'escrow-created-001' AND event_type = 'escrow.funded'")

  Scenario: Valid fund callback updates status to funded and sets balance
    * def body = { "contractId": "escrow-created-001", "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 2500.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, balance FROM public.trustless_work_escrows WHERE contract_id = 'escrow-created-001'")
    And match rows[0].status == 'funded'
    And match rows[0].balance == '2500.0000000'

  Scenario: Duplicate fund callback is idempotent
    * def body = { "contractId": "escrow-created-001", "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 2500.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def afterFirst = db.query("SELECT status, balance, updated_at FROM public.trustless_work_escrows WHERE contract_id = 'escrow-created-001'")
    And match afterFirst[0].status == 'funded'
    And match afterFirst[0].balance == '2500.0000000'
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def afterSecond = db.query("SELECT status, balance, updated_at FROM public.trustless_work_escrows WHERE contract_id = 'escrow-created-001'")
    And match afterSecond[0].status == 'funded'
    And match afterSecond[0].balance == '2500.0000000'
    And match afterSecond[0].updated_at == afterFirst[0].updated_at
    * def events = db.query("SELECT processed FROM public.trustless_work_webhook_events WHERE contract_id = 'escrow-created-001' AND event_type = 'escrow.funded' ORDER BY created_at")
    And match events.length == 2
    And match events[0].processed == '#? _ == "true" || _ == "t" || _ == true'
    And match events[1].processed == '#? _ == "true" || _ == "t" || _ == true'

  Scenario: Missing contractId returns 400
    * def body = { "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 2500.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, signer, amount'

  Scenario: Missing signer returns 400
    * def body = { "contractId": "escrow-created-001", "amount": 2500.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, signer, amount'

  Scenario: Amount zero returns 400
    * def body = { "contractId": "escrow-created-001", "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 0 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Amount cannot be zero or negative'

  Scenario: Unknown contractId returns 404
    * def body = { "contractId": "non-existent-contract-xyz", "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 1000.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'

  Scenario: Missing signature header returns 401
    * def body = { "contractId": "escrow-created-001", "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 2500.00 }
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Missing x-trustlesswork-signature header'

  Scenario: Incorrect signature returns 401
    * def body = { "contractId": "escrow-created-001", "signer": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "amount": 2500.00 }
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Invalid webhook signature'
