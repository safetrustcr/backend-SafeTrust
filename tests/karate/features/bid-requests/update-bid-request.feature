Feature: PATCH /api/bid-requests/:id

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-apartments.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-bids.sql'))

  Scenario: Owner approves PENDING bid → 200, status = APPROVED
    Given path '/api/bid-requests/11111111-1111-1111-1111-111111111111'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'owner-123'
    And request { "status": "APPROVED" }
    When method PATCH
    Then status 200
    And match response.bid.current_status == 'APPROVED'

  Scenario: Owner cancels PENDING bid → 200, status = CANCELLED
    Given path '/api/bid-requests/11111111-1111-1111-1111-111111111111'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'owner-123'
    And request { "status": "CANCELLED" }
    When method PATCH
    Then status 200
    And match response.bid.current_status == 'CANCELLED'

  Scenario: Non-owner tries to update → 403
    Given path '/api/bid-requests/11111111-1111-1111-1111-111111111111'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'other-user'
    And request { "status": "APPROVED" }
    When method PATCH
    Then status 403
    And match response.error == 'Only owner can approve'

  Scenario: Invalid transition (CANCELLED → APPROVED) → 400
    # First cancel it
    * db.execute("UPDATE bid_requests SET current_status = 'CANCELLED' WHERE id = '11111111-1111-1111-1111-111111111111'")
    
    Given path '/api/bid-requests/11111111-1111-1111-1111-111111111111'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'owner-123'
    And request { "status": "APPROVED" }
    When method PATCH
    Then status 400
    And match response.error == 'Invalid transition'

  Scenario: Non-existent bid → 404
    Given path '/api/bid-requests/99999999-9999-9999-9999-999999999999'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'owner-123'
    And request { "status": "APPROVED" }
    When method PATCH
    Then status 404
    And match response.error == 'Bid not found'

  Scenario: No token → 401
    Given path '/api/bid-requests/11111111-1111-1111-1111-111111111111'
    And request { "status": "APPROVED" }
    When method PATCH
    Then status 401
