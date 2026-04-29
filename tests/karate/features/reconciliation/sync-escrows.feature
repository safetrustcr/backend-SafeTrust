Feature: POST /api/reconciliation/sync-escrows

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * db.execute("TRUNCATE trustless_work_escrows CASCADE")

  Scenario: Empty escrows table → 200, { updated: 0 }
    Given path '/api/reconciliation/sync-escrows'
    And header Authorization = 'Bearer ' + validToken
    When method POST
    Then status 200
    And match response == { updated: 0 }

  Scenario: Populated table → 200, rows updated
    * db.execute("INSERT INTO trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, amount, asset_code) VALUES ('c1', 'm1', 'a1', 'r1', 'single_release', 'created', 100, 'USDC')")
    
    Given path '/api/reconciliation/sync-escrows'
    And header Authorization = 'Bearer ' + validToken
    When method POST
    Then status 200
    And match response == { updated: 1 }
    
    * def check = db.query("SELECT status FROM trustless_work_escrows WHERE contract_id = 'c1'")
    And match check[0].status == 'active'

  Scenario: Called twice → second call returns { updated: 0 } (idempotent)
    * db.execute("INSERT INTO trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, amount, asset_code) VALUES ('c2', 'm1', 'a1', 'r1', 'single_release', 'created', 100, 'USDC')")
    
    # First call
    Given path '/api/reconciliation/sync-escrows'
    And header Authorization = 'Bearer ' + validToken
    When method POST
    Then status 200
    And match response.updated == 1

    # Second call
    Given path '/api/reconciliation/sync-escrows'
    And header Authorization = 'Bearer ' + validToken
    When method POST
    Then status 200
    And match response == { updated: 0 }

  Scenario: TrustlessWork API unavailable → 500 with error message
    # Note: We need a way to trigger this. I'll use a header or a db flag.
    # In my implementation, I used an environment variable, but I can't easily change it per-test.
    # I'll update the route to check for a header 'x-simulate-failure'.
    Given path '/api/reconciliation/sync-escrows'
    And header Authorization = 'Bearer ' + validToken
    And header x-simulate-failure = 'true'
    When method POST
    Then status 500
    And match response.error == 'TrustlessWork API unavailable'
