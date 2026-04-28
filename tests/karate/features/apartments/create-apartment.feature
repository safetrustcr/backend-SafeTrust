Feature: POST /api/apartments

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))

  Scenario: Valid body → 201, apartment in DB
    Given path '/api/apartments'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = 'owner-123'
    And request
    """
    {
      "name": "New Modern Flat",
      "description": "City center",
      "price": 2500.00,
      "bedrooms": 2,
      "pet_friendly": true,
      "category": "Apartment",
      "address": {"city": "San José"},
      "coordinates": {"x": 9.9, "y": -84.1}
    }
    """
    When method POST
    Then status 201
    And match response.apartment.name == 'New Modern Flat'
    And match response.apartment.owner_id == 'owner-123'
    
    * def count = db.query("SELECT COUNT(*) FROM apartments WHERE name = 'New Modern Flat'")
    And match count[0].count == '1'

  Scenario: Missing name → 400
    Given path '/api/apartments'
    And header Authorization = 'Bearer ' + validToken
    And request { "price": 1000 }
    When method POST
    Then status 400
    And match response.error == 'Missing name'

  Scenario: Missing pricePerMonth → 400
    Given path '/api/apartments'
    And header Authorization = 'Bearer ' + validToken
    And request { "name": "No Price" }
    When method POST
    Then status 400
    And match response.error == 'Missing pricePerMonth'

  Scenario: No token → 401
    Given path '/api/apartments'
    And request { "name": "Anon" }
    When method POST
    Then status 401
