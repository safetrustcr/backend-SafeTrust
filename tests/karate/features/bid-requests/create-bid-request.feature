Feature: POST /api/bid-requests

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-apartments.sql'))
    * db.execute("DELETE FROM bid_requests")

  Scenario: Valid body → 201, bid in DB
    Given path '/api/bid-requests'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'tenant-456'
    And request
    """
    {
      "apartment_id": "00000000-0000-0000-0000-000000000001",
      "proposed_price": 4500.00,
      "desired_move_in": "2026-06-01T00:00:00Z"
    }
    """
    When method POST
    Then status 201
    And match response.bid.current_status == 'PENDING'
    And match response.bid.tenant_id == 'tenant-456'

  Scenario: Duplicate pending bid → 409
    # First bid
    Given path '/api/bid-requests'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'tenant-456'
    And request
    """
    {
      "apartment_id": "00000000-0000-0000-0000-000000000002",
      "proposed_price": 1400.00,
      "desired_move_in": "2026-06-01T00:00:00Z"
    }
    """
    When method POST
    Then status 201

    # Second bid for same apartment
    Given path '/api/bid-requests'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'tenant-456'
    And request
    """
    {
      "apartment_id": "00000000-0000-0000-0000-000000000002",
      "proposed_price": 1450.00,
      "desired_move_in": "2026-06-01T00:00:00Z"
    }
    """
    When method POST
    Then status 409
    And match response.error == 'Duplicate pending bid'

  Scenario: Missing fields → 400
    Given path '/api/bid-requests'
    And header Authorization = 'Bearer ' + validToken
    And request { "proposed_price": 1000 }
    When method POST
    Then status 400
    And match response.error == 'Missing required fields'

  Scenario: No token → 401
    Given path '/api/bid-requests'
    And request { "apartment_id": "..." }
    When method POST
    Then status 401
