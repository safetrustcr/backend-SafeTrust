Feature: POST /api/escrows/resolve-dispute — TrustlessWork dispute resolution callback

  Background:
    * url webhookUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  Scenario: Valid resolve callback updates status to resolved and zeroes balance
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-disputed-001",
      "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111",
      "resolutionNote": "Resolved in favor of host"
    }
    """
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, (balance = 0::numeric) AS balance_is_zero FROM public.trustless_work_escrows WHERE contract_id = 'escrow-disputed-001'")
    And match rows[0].status == 'resolved'
    And match rows[0].balance_is_zero == 'true'

  Scenario: Missing contractId returns 400
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And request { "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111" }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, resolver'

  Scenario: Missing resolver returns 400
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And request { "contractId": "escrow-disputed-001" }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, resolver'

  Scenario: Unknown contractId returns 404
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "non-existent-xyz",
      "resolver": "GRESOLVER111WALLETADDRESS111111111111111111111111111111111"
    }
    """
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'
