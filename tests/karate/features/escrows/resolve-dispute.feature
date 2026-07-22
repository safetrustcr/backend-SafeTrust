Feature: POST /api/escrows/resolve-dispute — TrustlessWork dispute resolution callback

  Background:
    * url webhookUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Valid resolve callback updates status to resolved and zeroes balance
    * def body = { "contractId": "escrow-disputed-001", "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111", "resolutionNote": "Resolved in favor of host" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, (CASE WHEN balance = 0::numeric THEN 1 ELSE 0 END) AS balance_is_zero FROM public.trustless_work_escrows WHERE contract_id = 'escrow-disputed-001'")
    And match rows[0].status == 'resolved'
    And match rows[0].balance_is_zero == '1'

  Scenario: Missing contractId returns 400
    * def body = { "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, resolver'

  Scenario: Missing resolver returns 400
    * def body = { "contractId": "escrow-disputed-001" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, resolver'

  Scenario: Unknown contractId returns 404
    * def body = { "contractId": "non-existent-xyz", "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'

  Scenario: Missing signature header returns 401
    * def body = { "contractId": "escrow-disputed-001", "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111" }
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Missing x-trustlesswork-signature header'

  Scenario: Incorrect signature returns 401
    * def body = { "contractId": "escrow-disputed-001", "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111" }
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Invalid webhook signature'
