Feature: GET /api/apartments

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-apartments.sql'))

  Scenario: No filters → 200, paginated list
    Given path '/api/apartments'
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 200
    And match response.apartments == '#[]'
    And match response.total == '#number'
    And match response.page == 1

  Scenario: ?location=San+José → filtered results
    Given path '/api/apartments'
    And param location = 'San José'
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 200
    And match each response.apartments[*].name contains 'San José'

  Scenario: ?minPrice=3000&maxPrice=5000 → price range filter
    Given path '/api/apartments'
    And param minPrice = 3000
    And param maxPrice = 5000
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 200
    And match each response.apartments[*].price == '#? _ >= 3000 && _ <= 5000'

  Scenario: ?bedrooms=2 → bedroom filter
    Given path '/api/apartments'
    And param bedrooms = 2
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 200
    And match each response.apartments[*].bedrooms == 2

  Scenario: ?page=2&limit=1 → correct page returned
    Given path '/api/apartments'
    And param page = 2
    And param limit = 1
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 200
    And match response.page == 2
    And match karate.sizeOf(response.apartments) == 1

  Scenario: No token → 401
    Given path '/api/apartments'
    When method GET
    Then status 401
